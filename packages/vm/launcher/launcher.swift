// pine·trie's lane VM launcher (ADR-0130), from S131's probe. One per user:
// it keeps the VM running while any host holds a lease, gives each host a
// slot of its own, and bridges Docker with half-closes.
//
//   launcher <state dir> <image dir> <slots> <memory bytes> <cpus> <gvproxy>
//
// In <state dir>: launcher.lock (an exclusive flock: a second launcher exits
// at once), data.img (the data disk, 256 GiB sparse, formatted by the guest
// on first boot), console.log, gvproxy.log, empty/ (an empty slot's share),
// and the sockets docker.sock (the guest's vsock 2375), control.sock
// (leases), gv.sock and net.sock (the network card's frames) and gv-api.sock
// (gvproxy's API, on the Mac's side only).
//
// The VM's network is gvproxy's (gvisor-tap-vsock, S136), which the launcher
// runs and stops with the VM: the card's frames go to it as datagrams on a
// unix socket. Not Virtualization's NAT, which macOS shares between every VM
// on the Mac and which one `container run` took away (S135).
//
// The lease protocol is JSON, one message a line, on control.sock; its
// host's side is `packages/vm/protocol.ts`. A connection is a lease:
//   → {"kind":"lease","agent":<SSH_AUTH_SOCK or null>}
//   ← {"kind":"slot","slot":<i>,"docker":<docker.sock>} | refused
//   → {"kind":"fill","entries":[{"name","source","readOnly"}]}
//   ← {"kind":"filled"} | refused
//   → {"kind":"retire"}: stop the VM and exit, if this is the only lease
//   ← the connection's end | {"kind":"refused","reason":"busy",…}
// The slot reply also names the image and launcher the VM was started from,
// and the leases it holds.
// A refusal is {"kind":"refused","reason":<code>, …}. When the connection
// ends, the slot's share goes back to empty/ and the slot is free. A slot is
// filled once: replacing a share cuts every bind mount into it (S130), and
// slots are apart from each other (S131).
//
// The guest connects to vsock 2400+i for slot i's ssh agent; the launcher
// connects that to the agent its lease named. With no lease for
// LAUNCHER_IDLE_SECONDS (default 600), and on SIGTERM, it asks the guest to
// sync (vsock 2377), stops the VM, and exits.

import Foundation
import Virtualization

setvbuf(stdout, nil, _IOLBF, 0)
func log(_ s: String) { print("launcher: \(s)") }

let args = CommandLine.arguments
guard args.count == 9, let slotCount = Int(args[3]), let memoryBytes = UInt64(args[4]),
  let cpus = Int(args[5])
else {
  FileHandle.standardError.write(
    "usage: launcher <state dir> <image dir> <slots> <memory bytes> <cpus> <gvproxy> <synchronization> <caching>\n"
      .data(using: .utf8)!)
  exit(2)
}
let state = args[1]
let image = args[2]
let gvproxyBinary = args[6]
/// The disks' modes are the host's choice (`LAUNCHER_DISKS`, `packages/vm/plan.ts`).
let syncMode: VZDiskImageSynchronizationMode
switch args[7] {
case "fsync": syncMode = .fsync
case "full": syncMode = .full
default:
  log("synchronization must be fsync or full: \(args[7])")
  exit(2)
}
let cachingMode: VZDiskImageCachingMode
switch args[8] {
case "cached": cachingMode = .cached
case "automatic": cachingMode = .automatic
default:
  log("caching must be cached or automatic: \(args[8])")
  exit(2)
}
/// Under 1 GiB is a caller's mistake: Docker and lanes do not fit, and
/// Virtualization's floor (4 MiB) would boot a VM that fails to start.
guard memoryBytes >= 1 << 30 else {
  log("memory must be at least 1 GiB: \(memoryBytes) bytes")
  exit(2)
}
/// A VM boots with 20 share devices alongside its others, and not 24 (S131).
guard (1...20).contains(slotCount) else {
  log("slots must be 1 to 20: \(slotCount)")
  exit(2)
}

func url(_ p: String) -> URL { URL(fileURLWithPath: p) }
signal(SIGPIPE, SIG_IGN)

// One launcher per user: a second one leaves the first to serve.
let lockFd = open("\(state)/launcher.lock", O_CREAT | O_RDWR, 0o600)
guard lockFd >= 0, flock(lockFd, LOCK_EX | LOCK_NB) == 0 else {
  log("another launcher holds \(state)/launcher.lock")
  exit(0)
}

let env = ProcessInfo.processInfo.environment
let idleSeconds = Double(env["LAUNCHER_IDLE_SECONDS"] ?? "600") ?? 600

// The data disk: sparse, so only written blocks take space.
let dataPath = "\(state)/data.img"
if !FileManager.default.fileExists(atPath: dataPath) {
  let fd = open(dataPath, O_CREAT | O_RDWR, 0o600)
  guard fd >= 0, ftruncate(fd, off_t(256) << 30) == 0 else {
    log("cannot make \(dataPath): \(String(cString: strerror(errno)))")
    exit(1)
  }
  close(fd)
}
let emptyDir = "\(state)/empty"
try? FileManager.default.createDirectory(atPath: emptyDir, withIntermediateDirectories: true)

// The machine.
let config = VZVirtualMachineConfiguration()
config.cpuCount = max(
  VZVirtualMachineConfiguration.minimumAllowedCPUCount,
  min(cpus, VZVirtualMachineConfiguration.maximumAllowedCPUCount))
config.memorySize = max(
  VZVirtualMachineConfiguration.minimumAllowedMemorySize,
  min(memoryBytes / (1 << 20) * (1 << 20), VZVirtualMachineConfiguration.maximumAllowedMemorySize))
let boot = VZLinuxBootLoader(kernelURL: url("\(image)/Image"))
boot.initialRamdiskURL = url("\(image)/stage1.cpio")
boot.commandLine = "console=hvc0 quiet lane.slots=\(slotCount)"
config.bootLoader = boot

do {
  let system = try VZDiskImageStorageDeviceAttachment(
    url: url("\(image)/system.erofs"), readOnly: true, cachingMode: cachingMode,
    synchronizationMode: syncMode)
  let data = try VZDiskImageStorageDeviceAttachment(
    url: url(dataPath), readOnly: false, cachingMode: cachingMode, synchronizationMode: syncMode)
  config.storageDevices = [
    VZVirtioBlockDeviceConfiguration(attachment: system),
    VZVirtioBlockDeviceConfiguration(attachment: data),
  ]
} catch {
  log("disks: \(error)")
  exit(1)
}

// gvproxy, before the VM: the card connects to its socket.
let gvSocket = "\(state)/gv.sock"
for stale in [gvSocket, "\(state)/gv-api.sock"] { unlink(stale) }
let gvproxy = Process()
gvproxy.executableURL = url(gvproxyBinary)
// -ssh-port -1: gvproxy forwards none of the Mac's ports to the VM.
gvproxy.arguments = [
  "-ssh-port", "-1", "-listen-vfkit", "unixgram://\(gvSocket)", "-listen",
  "unix://\(state)/gv-api.sock",
]
FileManager.default.createFile(atPath: "\(state)/gvproxy.log", contents: nil)
let gvLog = FileHandle(forWritingAtPath: "\(state)/gvproxy.log")
gvproxy.standardOutput = gvLog
gvproxy.standardError = gvLog
do {
  try gvproxy.run()
} catch {
  log("gvproxy: \(error)")
  exit(1)
}
atexit {
  if gvproxy.isRunning { kill(gvproxy.processIdentifier, SIGTERM) }
}
var waited = 0
while !FileManager.default.fileExists(atPath: gvSocket) && waited < 100 {
  usleep(50_000)
  waited += 1
}
guard FileManager.default.fileExists(atPath: gvSocket) else {
  log("gvproxy made no socket in 5 s: see gvproxy.log")
  exit(1)
}

let net = VZVirtioNetworkDeviceConfiguration()
// The card's frames as datagrams on a unix socket connected to gvproxy, as
// vfkit does: bound to a path of our own, the first datagram "VFKT", and
// large buffers (vfkit's: 1 MiB to send, 4 MiB to receive).
do {
  let fd = socket(AF_UNIX, SOCK_DGRAM, 0)
  let local = "\(state)/net.sock"
  unlink(local)
  guard var here = unixAddress(local), var there = unixAddress(gvSocket) else {
    log("socket path too long: \(local)")
    exit(1)
  }
  let size = socklen_t(MemoryLayout<sockaddr_un>.size)
  let bound = withUnsafePointer(to: &here) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, size) }
  }
  let connected = withUnsafePointer(to: &there) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, size) }
  }
  guard bound == 0, connected == 0 else {
    log("gvproxy \(gvSocket): \(String(cString: strerror(errno)))")
    exit(1)
  }
  var sendBuffer = Int32(1 << 20)
  var receiveBuffer = Int32(4 << 20)
  setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &sendBuffer, socklen_t(MemoryLayout<Int32>.size))
  setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &receiveBuffer, socklen_t(MemoryLayout<Int32>.size))
  let magic = Array("VFKT".utf8)
  guard magic.withUnsafeBytes({ write(fd, $0.baseAddress, $0.count) }) == magic.count else {
    log("gvproxy handshake: \(String(cString: strerror(errno)))")
    exit(1)
  }
  net.attachment = VZFileHandleNetworkDeviceAttachment(
    fileHandle: FileHandle(fileDescriptor: fd, closeOnDealloc: true))
}
// gvproxy's DHCP has one lease, for this address (its default config).
net.macAddress = VZMACAddress(string: "5a:94:ef:e4:0c:ee")!
config.networkDevices = [net]

FileManager.default.createFile(atPath: "\(state)/console.log", contents: nil)
guard let consoleOut = FileHandle(forWritingAtPath: "\(state)/console.log") else {
  log("cannot write \(state)/console.log")
  exit(1)
}
let console = VZVirtioConsoleDeviceSerialPortConfiguration()
console.attachment = VZFileHandleSerialPortAttachment(
  fileHandleForReading: nil, fileHandleForWriting: consoleOut)
config.serialPorts = [console]
config.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]

func emptyShare() -> VZDirectoryShare {
  VZSingleDirectoryShare(directory: VZSharedDirectory(url: url(emptyDir), readOnly: true))
}
var shareDevices: [VZDirectorySharingDeviceConfiguration] = []
for i in 0..<slotCount {
  let slot = VZVirtioFileSystemDeviceConfiguration(tag: "slot\(i)")
  slot.share = emptyShare()
  shareDevices.append(slot)
}
config.directorySharingDevices = shareDevices
config.socketDevices = [VZVirtioSocketDeviceConfiguration()]

do {
  try config.validate()
} catch {
  log("configuration: \(error)")
  exit(1)
}
let vm = VZVirtualMachine(configuration: config)

final class Delegate: NSObject, VZVirtualMachineDelegate {
  func guestDidStop(_ virtualMachine: VZVirtualMachine) {
    log("guest stopped")
    exit(0)
  }
  func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
    log("stopped with error: \(error)")
    exit(1)
  }
}
let delegate = Delegate()
vm.delegate = delegate

// --- unix sockets and the half-close bridge (S128) ---------------------------

func unixAddress(_ path: String) -> sockaddr_un? {
  var addr = sockaddr_un()
  addr.sun_family = sa_family_t(AF_UNIX)
  let bytes = Array(path.utf8)
  guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { return nil }
  withUnsafeMutableBytes(of: &addr.sun_path) { buf in
    for (i, b) in bytes.enumerated() { buf[i] = b }
    buf[bytes.count] = 0
  }
  addr.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
  return addr
}

func listenUnix(_ path: String) -> Int32 {
  unlink(path)
  guard var addr = unixAddress(path) else {
    log("socket path too long: \(path)")
    exit(1)
  }
  let fd = socket(AF_UNIX, SOCK_STREAM, 0)
  let bound = withUnsafePointer(to: &addr) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
      bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
  }
  guard bound == 0, chmod(path, 0o600) == 0, listen(fd, 64) == 0 else {
    log("listen \(path): \(String(cString: strerror(errno)))")
    exit(1)
  }
  return fd
}

/// A connected unix socket, or -1.
func connectUnix(_ path: String) -> Int32 {
  guard var addr = unixAddress(path) else { return -1 }
  let fd = socket(AF_UNIX, SOCK_STREAM, 0)
  let connected = withUnsafePointer(to: &addr) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
      connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
  }
  if connected != 0 {
    close(fd)
    return -1
  }
  return fd
}

/// A unix socket and its vsock connection; both closed when both directions end.
final class Pair {
  let fd: Int32
  let connection: VZVirtioSocketConnection
  private var open = 2
  private let lock = NSLock()
  init(fd: Int32, connection: VZVirtioSocketConnection) {
    self.fd = fd
    self.connection = connection
  }
  func directionEnded() {
    lock.lock()
    open -= 1
    let last = open == 0
    lock.unlock()
    if last {
      close(fd)
      DispatchQueue.main.async { self.connection.close() }
    }
  }
}

/// Copy `from` to `to` until `from` ends, then shut `to`'s write side: the end
/// travels on, and the other direction keeps flowing.
func pump(from: Int32, to: Int32, done: @escaping () -> Void) {
  Thread.detachNewThread {
    var buf = [UInt8](repeating: 0, count: 65536)
    loop: while true {
      let n = buf.withUnsafeMutableBytes { read(from, $0.baseAddress, $0.count) }
      if n < 0 && errno == EINTR { continue }
      if n <= 0 { break }
      var off = 0
      while off < n {
        let w = buf.withUnsafeBytes { write(to, $0.baseAddress! + off, n - off) }
        if w < 0 && errno == EINTR { continue }
        if w <= 0 { break loop }
        off += w
      }
    }
    shutdown(to, SHUT_WR)
    done()
  }
}

func bridge(_ fd: Int32, _ connection: VZVirtioSocketConnection) {
  let pair = Pair(fd: fd, connection: connection)
  pump(from: fd, to: connection.fileDescriptor) { pair.directionEnded() }
  pump(from: connection.fileDescriptor, to: fd) { pair.directionEnded() }
}

var socketDevice: VZVirtioSocketDevice? { vm.socketDevices.first as? VZVirtioSocketDevice }

/// Each client of `path` bridged to the guest's vsock `port`.
func serve(_ path: String, port: UInt32) {
  let fd = listenUnix(path)
  Thread.detachNewThread {
    while true {
      let client = accept(fd, nil, nil)
      if client < 0 {
        if errno == EINTR { continue }
        log("accept \(path): \(String(cString: strerror(errno)))")
        return
      }
      DispatchQueue.main.async {
        guard let device = socketDevice else {
          close(client)
          return
        }
        device.connect(toPort: port) { result in
          switch result {
          case .failure(let error):
            log("vsock \(port): \(error)")
            close(client)
          case .success(let connection):
            bridge(client, connection)
          }
        }
      }
    }
  }
}

// --- leases -------------------------------------------------------------------

/// One host's connection to control.sock. Touched on the main queue only.
final class Lease {
  let fd: Int32
  var slot: Int? = nil
  var agent: String? = nil
  var filled = false
  var ended = false
  init(fd: Int32) { self.fd = fd }
  func send(_ message: [String: Any]) {
    guard !ended, var data = try? JSONSerialization.data(withJSONObject: message) else { return }
    data.append(0x0A)
    data.withUnsafeBytes { buf in
      var off = 0
      while off < buf.count {
        let w = write(fd, buf.baseAddress! + off, buf.count - off)
        if w < 0 && errno == EINTR { continue }
        if w <= 0 { return }
        off += w
      }
    }
  }
  func refuse(_ reason: String, _ extra: [String: Any] = [:]) {
    var message: [String: Any] = ["kind": "refused", "reason": reason]
    for (key, value) in extra { message[key] = value }
    send(message)
  }
}

var slots: [Lease?] = Array(repeating: nil, count: slotCount)
var running = false
var waiting: [Lease] = []
var idle: DispatchWorkItem? = nil

func device(ofSlot i: Int) -> VZVirtioFileSystemDevice? {
  vm.directorySharingDevices.compactMap { $0 as? VZVirtioFileSystemDevice }
    .first { $0.tag == "slot\(i)" }
}

/// Replace slot `i`'s share on the running device (under 1 ms, S131).
func setShare(_ i: Int, _ share: VZDirectoryShare) -> Bool {
  let setter = NSSelectorFromString("setShare:")
  guard let device = device(ofSlot: i), device.responds(to: setter) else { return false }
  _ = device.perform(setter, with: share)
  return true
}

func scheduleIdleStop() {
  idle?.cancel()
  guard slots.allSatisfy({ $0 == nil }) else { return }
  let item = DispatchWorkItem { stopVM("no lease for \(Int(idleSeconds)) s") }
  idle = item
  DispatchQueue.main.asyncAfter(deadline: .now() + idleSeconds, execute: item)
}

func grant(_ lease: Lease) {
  guard let i = slots.firstIndex(where: { $0 == nil }) else {
    lease.refuse("full", ["slots": slotCount])
    return
  }
  slots[i] = lease
  lease.slot = i
  idle?.cancel()
  log("slot \(i) leased")
  // What this VM was started from, and its leases: a host whose image or
  // launcher is newer replaces it when it holds the only lease.
  lease.send([
    "kind": "slot", "slot": i, "docker": "\(state)/docker.sock",
    "image": url(image).lastPathComponent,
    "launcher": url(CommandLine.arguments[0]).lastPathComponent,
    "leases": slots.filter { $0 != nil }.count,
  ])
}

func handle(_ lease: Lease, _ message: [String: Any]?) {
  guard let message = message, let kind = message["kind"] as? String else {
    lease.refuse("unreadable")
    return
  }
  switch kind {
  case "lease":
    if lease.slot != nil || waiting.contains(where: { $0 === lease }) {
      lease.refuse("leased")
      return
    }
    lease.agent = message["agent"] as? String
    if running { grant(lease) } else { waiting.append(lease) }
  case "fill":
    guard let i = lease.slot else {
      lease.refuse("unleased")
      return
    }
    guard !lease.filled else {
      lease.refuse("filled")
      return
    }
    var dirs: [String: VZSharedDirectory] = [:]
    for entry in message["entries"] as? [[String: Any]] ?? [] {
      guard let name = entry["name"] as? String, let source = entry["source"] as? String,
        let readOnly = entry["readOnly"] as? Bool
      else {
        lease.refuse("unreadable")
        return
      }
      dirs[name] = VZSharedDirectory(url: url(source), readOnly: readOnly)
    }
    let share = dirs.isEmpty ? emptyShare() : VZMultipleDirectoryShare(directories: dirs)
    guard setShare(i, share) else {
      lease.refuse("share")
      return
    }
    lease.filled = true
    log("slot \(i) filled: \(dirs.count) directories")
    lease.send(["kind": "filled"])
  case "retire":
    // Only the last lease may: another host's lanes run on this VM.
    let held = slots.filter { $0 != nil }.count
    guard lease.slot != nil, held == 1 else {
      lease.refuse("busy", ["leases": held])
      return
    }
    stopVM("retired by a host with a newer image or launcher")
  default:
    lease.refuse("unreadable")
  }
}

/// The lease's connection ended: its host stopped or died. Its slot empties.
func end(_ lease: Lease) {
  lease.ended = true
  close(lease.fd)
  waiting.removeAll { $0 === lease }
  if let i = lease.slot, slots[i] === lease {
    slots[i] = nil
    _ = setShare(i, emptyShare())
    log("slot \(i) free")
  }
  scheduleIdleStop()
}

func serveLeases(_ path: String) {
  let fd = listenUnix(path)
  Thread.detachNewThread {
    while true {
      let client = accept(fd, nil, nil)
      if client < 0 {
        if errno == EINTR { continue }
        log("accept \(path): \(String(cString: strerror(errno)))")
        return
      }
      let lease = Lease(fd: client)
      Thread.detachNewThread {
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 65536)
        while true {
          let n = chunk.withUnsafeMutableBytes { read(client, $0.baseAddress, $0.count) }
          if n < 0 && errno == EINTR { continue }
          if n <= 0 { break }
          buffer.append(contentsOf: chunk[0..<n])
          while let nl = buffer.firstIndex(of: 0x0A) {
            let line = Data(buffer[buffer.startIndex..<nl])
            buffer.removeSubrange(buffer.startIndex...nl)
            let message = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any]
            DispatchQueue.main.async { handle(lease, message) }
          }
        }
        DispatchQueue.main.async { end(lease) }
      }
    }
  }
}

// --- each slot's ssh agent ----------------------------------------------------

/// The guest's connection to vsock 2400+i, bridged to slot i's lease's agent.
final class AgentListener: NSObject, VZVirtioSocketListenerDelegate {
  let slot: Int
  init(slot: Int) { self.slot = slot }
  func listener(
    _ listener: VZVirtioSocketListener,
    shouldAcceptNewConnection connection: VZVirtioSocketConnection,
    from socketDevice: VZVirtioSocketDevice
  ) -> Bool {
    guard let agent = slots[slot]?.agent else { return false }
    let fd = connectUnix(agent)
    guard fd >= 0 else { return false }
    bridge(fd, connection)
    return true
  }
}
/// Held here: a listener's delegate is weak.
var agentListeners: [(VZVirtioSocketListener, AgentListener)] = []

// --- stopping -----------------------------------------------------------------

var stopping = false
/// Ask the guest to sync its disks, then stop the VM and exit.
func stopVM(_ why: String) {
  guard !stopping else { return }
  stopping = true
  log("stopping: \(why)")
  let halt = {
    guard vm.canStop else { exit(0) }
    vm.stop { error in
      log("stopped\(error.map { ": \($0)" } ?? "")")
      exit(0)
    }
  }
  guard running, let device = socketDevice else {
    halt()
    return
  }
  var halted = false
  let once = {
    if halted { return }
    halted = true
    halt()
  }
  DispatchQueue.main.asyncAfter(deadline: .now() + 10) { once() }
  device.connect(toPort: 2377) { result in
    guard case .success(let connection) = result else {
      once()
      return
    }
    let fd = connection.fileDescriptor
    Thread.detachNewThread {
      var buf = [UInt8](repeating: 0, count: 64)
      while buf.withUnsafeMutableBytes({ read(fd, $0.baseAddress, $0.count) }) > 0 {}
      DispatchQueue.main.async {
        connection.close()
        log("guest synced")
        once()
      }
    }
  }
}

signal(SIGTERM, SIG_IGN)
let stopSignal = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
stopSignal.setEventHandler { stopVM("SIGTERM") }
stopSignal.resume()

// --- start --------------------------------------------------------------------

// A VM without its network serves no lane: it stops with gvproxy.
gvproxy.terminationHandler = { p in
  DispatchQueue.main.async { stopVM("gvproxy exited (status \(p.terminationStatus))") }
}
serveLeases("\(state)/control.sock")
scheduleIdleStop()
log("starting: \(slotCount) slots, \(config.memorySize >> 20) MiB, \(config.cpuCount) CPUs, image \(image)")
vm.start { result in
  switch result {
  case .success:
    running = true
    log("running")
    serve("\(state)/docker.sock", port: 2375)
    if let device = socketDevice {
      for i in 0..<slotCount {
        let listener = VZVirtioSocketListener()
        let agent = AgentListener(slot: i)
        listener.delegate = agent
        device.setSocketListener(listener, forPort: UInt32(2400 + i))
        agentListeners.append((listener, agent))
      }
    }
    for lease in waiting { grant(lease) }
    waiting = []
  case .failure(let error):
    log("start: \(error)")
    for lease in waiting { lease.refuse("boot", ["detail": "\(error)"]) }
    exit(1)
  }
}
dispatchMain()
