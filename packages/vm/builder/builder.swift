// The VM that builds the lane VM's image: boots a kernel and an initrd with
// one disk, NAT, entropy and a console, and exits when the guest stops.
//
//   builder <Image> <initrd> <disk> <memory bytes> <cpus> <console log>
//
// A console log of `-` is standard output.
// Exits 0 when the guest stops itself, 1 on any error. It does not know
// what the guest does: the initrd's /init builds, and writes to the disk.
import Foundation
import Virtualization

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("[builder] \(message)\n".utf8))
  exit(1)
}

let args = CommandLine.arguments
guard args.count == 7, let memory = UInt64(args[4]), let cpus = Int(args[5]) else {
  fail("usage: builder <Image> <initrd> <disk> <memory bytes> <cpus> <console log>")
}
func url(_ p: String) -> URL { URL(fileURLWithPath: p) }

let config = VZVirtualMachineConfiguration()
config.cpuCount = max(
  VZVirtualMachineConfiguration.minimumAllowedCPUCount,
  min(cpus, VZVirtualMachineConfiguration.maximumAllowedCPUCount))
config.memorySize = max(
  VZVirtualMachineConfiguration.minimumAllowedMemorySize,
  min(memory / (1 << 20) * (1 << 20), VZVirtualMachineConfiguration.maximumAllowedMemorySize))
let boot = VZLinuxBootLoader(kernelURL: url(args[1]))
boot.initialRamdiskURL = url(args[2])
boot.commandLine = "console=hvc0 rdinit=/init"
config.bootLoader = boot
do {
  config.storageDevices = [
    VZVirtioBlockDeviceConfiguration(
      attachment: try VZDiskImageStorageDeviceAttachment(url: url(args[3]), readOnly: false))
  ]
} catch {
  fail("the disk \(args[3]): \(error)")
}
let net = VZVirtioNetworkDeviceConfiguration()
net.attachment = VZNATNetworkDeviceAttachment()
config.networkDevices = [net]
func consoleHandle(_ p: String) -> FileHandle {
  if p == "-" { return FileHandle.standardOutput }
  FileManager.default.createFile(atPath: p, contents: nil)
  guard let h = FileHandle(forWritingAtPath: p) else {
    fail("the console log \(p) cannot be written")
  }
  return h
}
let consoleOut = consoleHandle(args[6])
let console = VZVirtioConsoleDeviceSerialPortConfiguration()
console.attachment = VZFileHandleSerialPortAttachment(
  fileHandleForReading: nil, fileHandleForWriting: consoleOut)
config.serialPorts = [console]
config.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
do {
  try config.validate()
} catch {
  fail("the machine: \(error)")
}

let vm = VZVirtualMachine(configuration: config)
final class Delegate: NSObject, VZVirtualMachineDelegate {
  func guestDidStop(_ virtualMachine: VZVirtualMachine) { exit(0) }
  func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
    fail("the VM stopped: \(error)")
  }
}
let delegate = Delegate()
vm.delegate = delegate
vm.start { result in
  if case .failure(let error) = result { fail("the VM did not start: \(error)") }
}
RunLoop.main.run()
