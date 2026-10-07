// pine·trie's lane VM launcher (ADR-0103), from S131's probe. One per user:
// it keeps the VM running while any host holds a lease, gives each host a
// slot of its own, and bridges Docker with half-closes.
//
//   launcher <state dir> <image dir> <slots> <memory bytes> <cpus>
//
// In <state dir>: launcher.lock (an exclusive flock: a second launcher exits
// at once), data.img (the data disk, 256 GiB sparse, formatted by the guest
// on first boot), mac (the VM's MAC address), console.log, empty/ (an empty
// slot's share), and the
// sockets docker.sock (the guest's vsock 2375) and control.sock (leases).
//
// The lease protocol is JSON, one message a line, on control.sock; its
// host's side is `packages/vm/protocol.ts`. A connection is a lease:
//   → {"kind":"lease","agent":<SSH_AUTH_SOCK or null>}
//   ← {"kind":"slot","slot":<i>,"docker":<docker.sock>} | refused
//   → {"kind":"fill","entries":[{"name","source","readOnly"}]}
//   ← {"kind":"filled"} | refused
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
guard args.count == 6, let slotCount = Int(args[3]), let memoryBytes = UInt64(args[4]),
  let cpus = Int(args[5])
else {
  FileHandle.standardError.write(
    "usage: launcher <state dir> <image dir> <slots> <memory bytes> <cpus>\n".data(using: .utf8)!)
  exit(2)
}
let state = args[1]
let image = args[2]
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

// fsync and cached: Apple's defaults, full and automatic, made every
// `docker run` about 500 ms (S129).
do {
  let system = try VZDiskImageStorageDeviceAttachment(
    url: url("\(image)/system.erofs"), readOnly: true, cachingMode: .cached,
    synchronizationMode: .fsync)
  let data = try VZDiskImageStorageDeviceAttachment(
    url: url(dataPath), readOnly: false, cachingMode: .cached, synchronizationMode: .fsync)
  config.storageDevices = [
    VZVirtioBlockDeviceConfiguration(attachment: system),
    VZVirtioBlockDeviceConfiguration(attachment: data),
  ]
} catch {
  log("disks: \(error)")
  exit(1)
}

let net = VZVirtioNetworkDeviceConfiguration()
net.attachment = VZNATNetworkDeviceAttachment()
// One MAC address per state directory, kept in <state dir>/mac: a random
// one each boot takes a new DHCP lease from the Mac each boot. Written
// through a symlink (not atomically), so a test's VM can keep its own.
let macPath = "\(state)/mac"
if let text = try? String(contentsOfFile: macPath, encoding: .utf8),
  let kept = VZMACAddress(string: text.trimmingCharacters(in: .whitespacesAndNewlines))
{
  net.macAddress = kept
} else {
  let made = VZMACAddress.randomLocallyAdministered()
  try? made.string.write(toFile: macPath, atomically: false, encoding: .utf8)
  net.macAddress = made
}
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
  lease.send(["kind": "slot", "slot": i, "docker": "\(state)/docker.sock"])
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
