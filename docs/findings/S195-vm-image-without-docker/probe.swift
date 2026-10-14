// S195 probe: boot Image + initrd.cpio, NAT, console to stdout, out.img as vdb.
import Foundation
import Virtualization
let dir = CommandLine.arguments[1]
func url(_ p: String) -> URL { URL(fileURLWithPath: "\(dir)/\(p)") }
let config = VZVirtualMachineConfiguration()
config.cpuCount = ProcessInfo.processInfo.processorCount
config.memorySize = UInt64(CommandLine.arguments.count > 2 ? Int(CommandLine.arguments[2])! : 4096) << 20
let boot = VZLinuxBootLoader(kernelURL: url("Image"))
boot.initialRamdiskURL = url("initrd.cpio")
boot.commandLine = "console=hvc0 rdinit=/init"
config.bootLoader = boot
config.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment:
  try! VZDiskImageStorageDeviceAttachment(url: url("out.img"), readOnly: false))]
let net = VZVirtioNetworkDeviceConfiguration()
net.attachment = VZNATNetworkDeviceAttachment()
config.networkDevices = [net]
let console = VZVirtioConsoleDeviceSerialPortConfiguration()
console.attachment = VZFileHandleSerialPortAttachment(
  fileHandleForReading: nil, fileHandleForWriting: FileHandle.standardOutput)
config.serialPorts = [console]
config.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
try! config.validate()
let vm = VZVirtualMachine(configuration: config)
final class D: NSObject, VZVirtualMachineDelegate {
  func guestDidStop(_ v: VZVirtualMachine) { FileHandle.standardError.write("[probe] guest stopped\n".data(using: .utf8)!); exit(0) }
  func virtualMachine(_ v: VZVirtualMachine, didStopWithError e: Error) { FileHandle.standardError.write("[probe] error \(e)\n".data(using: .utf8)!); exit(1) }
}
let d = D(); vm.delegate = d
vm.start { r in if case .failure(let e) = r { FileHandle.standardError.write("[probe] start failed \(e)\n".data(using: .utf8)!); exit(1) } }
RunLoop.main.run()
