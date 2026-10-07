// S131 probe: S128's launcher with share slots. LAUNCHER_SLOTS (default 4)
// share devices tagged slot0, slot1, …, each an empty, read-only placeholder
// at boot. On SIGUSR1 it reads <dir>/slots.txt (one line per directory: slot
// number, name, path, ro or rw, separated by tabs) and replaces the share of
// each slot whose set changed, and of no other. The question: does replacing
// one slot leave containers' bind mounts into the others working?
//
//   launcher <dir> <repo> <system image>
//
// Boots <dir>/Image with <dir>/stage1.cpio, the system image read-only as
// /dev/vda and <dir>/data.img as /dev/vdb. Shares <repo> as "repo" with the
// read-only flag set on the Mac's side, and the slots. The serial
// console goes to <dir>/serial.log.
//
// Bridges the unix sockets <dir>/docker.sock and <dir>/ctl.sock to the guest's
// vsock ports 2375 and 2376. Each direction's end becomes a shutdown of the
// other side's write, so a client's half-close reaches the guest (vfkit's
// bridge drops it, S126).
//
// LAUNCHER_DISK_SYNC (fsync, full or none; default fsync) and
// LAUNCHER_DISK_CACHE (cached, automatic or uncached; default cached) set how
// the disk images meet the Mac's disk. Apple's defaults, full and automatic,
// made every `docker run` about 500 ms (S129).
//
// SIGUSR1 replaces the slots whose set changed in slots.txt.
// SIGTERM stops the VM.

import Foundation
import Virtualization

setvbuf(stdout, nil, _IOLBF, 0)
func log(_ s: String) { print("launcher: \(s)") }

let args = CommandLine.arguments
guard args.count == 4 else {
  FileHandle.standardError.write(
    "usage: launcher <dir> <repo> <system image>\n".data(using: .utf8)!)
  exit(2)
}
let dir = args[1], repo = args[2], systemImage = args[3]

func url(_ p: String) -> URL { URL(fileURLWithPath: p) }

/// Each slot's directories in slots.txt, as one line each, sorted: a slot's
/// text changes exactly when its set does.
func slotTexts() -> [Int: String] {
  let text = (try? String(contentsOfFile: "\(dir)/slots.txt", encoding: .utf8)) ?? ""
  var bySlot: [Int: [String]] = [:]
  for line in text.split(separator: "\n") {
    let f = line.split(separator: "\t").map(String.init)
    guard f.count == 4, let i = Int(f[0]) else { continue }
    bySlot[i, default: []].append(f[1...].joined(separator: "\t"))
  }
  return bySlot.mapValues { $0.sorted().joined(separator: "\n") }
}

signal(SIGPIPE, SIG_IGN)

// The machine.
let config = VZVirtualMachineConfiguration()
config.cpuCount = 4
config.memorySize = 8 << 30
let boot = VZLinuxBootLoader(kernelURL: url("\(dir)/Image"))
boot.initialRamdiskURL = url("\(dir)/stage1.cpio")
boot.commandLine = "console=hvc0 quiet lane.root=disk lane.data=/dev/vdb"
config.bootLoader = boot

let env = ProcessInfo.processInfo.environment
let syncMode: VZDiskImageSynchronizationMode
switch env["LAUNCHER_DISK_SYNC"] ?? "fsync" {
case "full": syncMode = VZDiskImageSynchronizationMode.full
case "none": syncMode = VZDiskImageSynchronizationMode.none
default: syncMode = VZDiskImageSynchronizationMode.fsync
}
let cacheMode: VZDiskImageCachingMode
switch env["LAUNCHER_DISK_CACHE"] ?? "cached" {
case "automatic": cacheMode = VZDiskImageCachingMode.automatic
case "uncached": cacheMode = VZDiskImageCachingMode.uncached
default: cacheMode = VZDiskImageCachingMode.cached
}
log("disks: sync \(env["LAUNCHER_DISK_SYNC"] ?? "fsync"), cache \(env["LAUNCHER_DISK_CACHE"] ?? "cached")")

do {
  let system = try VZDiskImageStorageDeviceAttachment(
    url: url(systemImage), readOnly: true, cachingMode: cacheMode, synchronizationMode: syncMode)
  let data = try VZDiskImageStorageDeviceAttachment(
    url: url("\(dir)/data.img"), readOnly: false, cachingMode: cacheMode,
    synchronizationMode: syncMode)
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
config.networkDevices = [net]

FileManager.default.createFile(atPath: "\(dir)/serial.log", contents: nil)
guard let serialOut = FileHandle(forWritingAtPath: "\(dir)/serial.log") else {
  log("cannot write \(dir)/serial.log")
  exit(1)
}
let console = VZVirtioConsoleDeviceSerialPortConfiguration()
console.attachment = VZFileHandleSerialPortAttachment(
  fileHandleForReading: nil, fileHandleForWriting: serialOut)
config.serialPorts = [console]
config.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]

let slotCount = Int(env["LAUNCHER_SLOTS"] ?? "4") ?? 4
let placeholder = "\(dir)/placeholder"
func placeholderShare() -> VZDirectoryShare {
  VZSingleDirectoryShare(directory: VZSharedDirectory(url: url(placeholder), readOnly: true))
}
/// A slot's share for its text: the placeholder when it holds nothing.
func shareFor(_ text: String) -> VZDirectoryShare {
  var dirs: [String: VZSharedDirectory] = [:]
  for line in text.split(separator: "\n") {
    let f = line.split(separator: "\t").map(String.init)
    if f.count == 3 { dirs[f[0]] = VZSharedDirectory(url: url(f[1]), readOnly: f[2] == "ro") }
  }
  return dirs.isEmpty ? placeholderShare() : VZMultipleDirectoryShare(directories: dirs)
}
var applied: [Int: String] = [:]

let repoShare = VZVirtioFileSystemDeviceConfiguration(tag: "repo")
repoShare.share = VZSingleDirectoryShare(
  directory: VZSharedDirectory(url: url(repo), readOnly: true))
var shareDevices: [VZDirectorySharingDeviceConfiguration] = [repoShare]
for i in 0..<slotCount {
  let slot = VZVirtioFileSystemDeviceConfiguration(tag: "slot\(i)")
  slot.share = placeholderShare()
  shareDevices.append(slot)
}
config.directorySharingDevices = shareDevices
log("\(slotCount) slots")
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

// Unix sockets on the Mac, each bridged to a guest vsock port.
func listenUnix(_ path: String) -> Int32 {
  unlink(path)
  let fd = socket(AF_UNIX, SOCK_STREAM, 0)
  var addr = sockaddr_un()
  addr.sun_family = sa_family_t(AF_UNIX)
  let bytes = Array(path.utf8)
  let capacity = MemoryLayout.size(ofValue: addr.sun_path)
  guard bytes.count < capacity else {
    log("socket path too long (\(bytes.count) of \(capacity)): \(path)")
    exit(1)
  }
  withUnsafeMutableBytes(of: &addr.sun_path) { buf in
    for (i, b) in bytes.enumerated() { buf[i] = b }
    buf[bytes.count] = 0
  }
  addr.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
  let bound = withUnsafePointer(to: &addr) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
      bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
  }
  guard bound == 0, listen(fd, 64) == 0 else {
    log("listen \(path): \(String(cString: strerror(errno)))")
    exit(1)
  }
  return fd
}

/// One client and its vsock connection; both closed when both directions end.
final class Pair {
  let client: Int32
  let connection: VZVirtioSocketConnection
  private var open = 2
  private let lock = NSLock()
  init(client: Int32, connection: VZVirtioSocketConnection) {
    self.client = client
    self.connection = connection
  }
  func directionEnded() {
    lock.lock()
    open -= 1
    let last = open == 0
    lock.unlock()
    if last {
      close(client)
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
        guard let device = vm.socketDevices.first as? VZVirtioSocketDevice else {
          close(client)
          return
        }
        device.connect(toPort: port) { result in
          switch result {
          case .failure(let error):
            log("vsock \(port): \(error)")
            close(client)
          case .success(let connection):
            let pair = Pair(client: client, connection: connection)
            pump(from: client, to: connection.fileDescriptor) { pair.directionEnded() }
            pump(from: connection.fileDescriptor, to: client) { pair.directionEnded() }
          }
        }
      }
    }
  }
}

// Signals: replace the slots whose set changed, or stop.
signal(SIGUSR1, SIG_IGN)
let swapSignal = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
swapSignal.setEventHandler {
  let want = slotTexts()
  let devices = vm.directorySharingDevices.compactMap { $0 as? VZVirtioFileSystemDevice }
  let setter = NSSelectorFromString("setShare:")
  for i in 0..<slotCount {
    let text = want[i] ?? ""
    if (applied[i] ?? "") == text { continue }
    guard let device = devices.first(where: { $0.tag == "slot\(i)" }), device.responds(to: setter)
    else {
      log("slot\(i): no running device, or no setShare:")
      continue
    }
    let started = Date()
    _ = device.perform(setter, with: shareFor(text))
    applied[i] = text
    let names = text.split(separator: "\n").map { String($0.split(separator: "\t")[0]) }
    log("slot\(i) replaced: \(names.isEmpty ? "empty" : names.joined(separator: ", ")) in \(Int(Date().timeIntervalSince(started) * 1000)) ms")
  }
}
swapSignal.resume()

signal(SIGTERM, SIG_IGN)
let stopSignal = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
stopSignal.setEventHandler {
  guard vm.canStop else { exit(0) }
  vm.stop { error in
    log("stopped\(error.map { ": \($0)" } ?? "")")
    exit(0)
  }
}
stopSignal.resume()

vm.start { result in
  switch result {
  case .success:
    log("running")
    serve("\(dir)/docker.sock", port: 2375)
    serve("\(dir)/ctl.sock", port: 2376)
  case .failure(let error):
    log("start: \(error)")
    exit(1)
  }
}
dispatchMain()
