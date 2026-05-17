import Foundation
import AVFoundation
import CoreAudio
import AppKit

// MARK: - Protocol types

struct SidecarCommand: Decodable {
    let cmd: String
    let socketPath: String?
    let source: SidecarSource?
    let sourceId: String?
}

struct SidecarSource: Decodable {
    let type: String
    let bundleId: String?
    let matchedSite: String?
    let pid: Int32?
}

// MARK: - Audio source manager

@available(macOS 14.2, *)
final class AudioSourceManager {
    private var sources: [String: AudioSource] = [:]
    private let socketWriter: SocketWriter

    init(socketWriter: SocketWriter) {
        self.socketWriter = socketWriter
    }

    func addSource(id: String, spec: SidecarSource) throws {
        let source: AudioSource
        switch spec.type {
        case "mic":
            source = try MicSource(id: id, sampleRate: 16000, writer: socketWriter)
        case "app", "browser":
            guard let bundleId = spec.bundleId else {
                throw AudioTapError.missingBundleId
            }
            source = try ProcessTapSource(
                id: id,
                bundleId: bundleId,
                sampleRate: 16000,
                writer: socketWriter
            )
        default:
            throw AudioTapError.unknownSourceType(spec.type)
        }
        sources[id] = source
        try source.start()
        emit(type: "source:started", sourceId: id)
    }

    func removeSource(id: String) {
        sources[id]?.stop()
        sources.removeValue(forKey: id)
        emit(type: "source:stopped", sourceId: id)
    }

    func stopAll() {
        for (_, source) in sources { source.stop() }
        sources.removeAll()
    }

    private func emit(type: String, sourceId: String? = nil) {
        var dict: [String: String] = ["type": type]
        if let sourceId { dict["sourceId"] = sourceId }
        if let data = try? JSONSerialization.data(withJSONObject: dict),
           let line = String(data: data, encoding: .utf8) {
            FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
        }
    }
}

// MARK: - Protocol

protocol AudioSource {
    func start() throws
    func stop()
}

// MARK: - Mic source

final class MicSource: AudioSource {
    private let id: String
    private let engine = AVAudioEngine()
    private let writer: SocketWriter
    private let targetRate: Double

    init(id: String, sampleRate: Double, writer: SocketWriter) throws {
        self.id = id
        self.targetRate = sampleRate
        self.writer = writer
    }

    func start() throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)

        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let self,
                  let channelData = buffer.floatChannelData?[0] else { return }
            let count = Int(buffer.frameLength)
            guard count > 0 else { return }

            let samples: [Float]
            if abs(format.sampleRate - self.targetRate) < 1 {
                samples = Array(UnsafeBufferPointer(start: channelData, count: count))
            } else {
                samples = Self.resample(
                    channelData,
                    count: count,
                    fromRate: format.sampleRate,
                    toRate: self.targetRate
                )
            }

            self.writer.write(
                sourceId: self.id,
                samples: samples,
                tsMs: Int64(Date().timeIntervalSince1970 * 1000)
            )
        }
        try engine.start()
    }

    private static func resample(
        _ data: UnsafePointer<Float>,
        count: Int,
        fromRate: Double,
        toRate: Double
    ) -> [Float] {
        let ratio = toRate / fromRate
        let outCount = max(1, Int(Double(count) * ratio))
        var out = [Float](repeating: 0, count: outCount)
        for i in 0..<outCount {
            let srcPos = Double(i) / ratio
            let idx = min(Int(srcPos), count - 1)
            let frac = Float(srcPos - Double(idx))
            let a = data[idx]
            let b = data[min(idx + 1, count - 1)]
            out[i] = a + (b - a) * frac
        }
        return out
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

// MARK: - Process tap source

@available(macOS 14.2, *)
final class ProcessTapSource: AudioSource {
    private let id: String
    private let bundleId: String
    private let writer: SocketWriter
    private var tapID: AudioObjectID = 0
    private var aggregateDeviceID: AudioObjectID = 0
    private var ioProcID: AudioDeviceIOProcID?
    private var running = false

    init(id: String, bundleId: String, sampleRate: Double, writer: SocketWriter) throws {
        self.id = id
        self.bundleId = bundleId
        self.writer = writer
    }

    func start() throws {
        guard let pid = findPID(forBundleId: bundleId) else {
            throw AudioTapError.processNotFound(bundleId)
        }

        var processObjectID: AudioObjectID = 0
        var pidVal = pid
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = withUnsafePointer(to: &pidVal) { pidPtr in
            AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject),
                &addr, UInt32(MemoryLayout<pid_t>.size), pidPtr, &size, &processObjectID
            )
        }
        guard status == noErr else {
            throw AudioTapError.coreAudioError("TranslatePIDToProcessObject", status)
        }

        let tapDesc = CATapDescription(stereoMixdownOfProcesses: [processObjectID])
        tapDesc.uuid = UUID()
        tapDesc.muteBehavior = .unmuted

        var newTapID: AudioObjectID = 0
        let tapStatus = AudioHardwareCreateProcessTap(tapDesc, &newTapID)
        guard tapStatus == noErr else {
            throw AudioTapError.coreAudioError("CreateProcessTap", tapStatus)
        }
        self.tapID = newTapID

        let uid = "notetaker-tap-\(id)-\(UUID().uuidString)"
        let aggregateDesc: [String: Any] = [
            kAudioAggregateDeviceNameKey: "NoteTaker-\(id)",
            kAudioAggregateDeviceUIDKey: uid,
            kAudioAggregateDeviceSubDeviceListKey: [
                [kAudioSubDeviceUIDKey: uid]
            ],
            kAudioAggregateDeviceMasterSubDeviceKey: uid,
            kAudioAggregateDeviceIsPrivateKey: true,
        ]

        var aggID: AudioObjectID = 0
        let aggStatus = AudioHardwareCreateAggregateDevice(
            aggregateDesc as CFDictionary, &aggID
        )
        guard aggStatus == noErr else {
            throw AudioTapError.coreAudioError("CreateAggregateDevice", aggStatus)
        }
        self.aggregateDeviceID = aggID

        var procID: AudioDeviceIOProcID?
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        let ioStatus = AudioDeviceCreateIOProcIDWithBlock(
            &procID, aggID, nil
        ) { _, inputData, _, _, _ in
            let mgr = Unmanaged<ProcessTapSource>.fromOpaque(selfPtr).takeUnretainedValue()
            mgr.handleInput(inputData)
        }
        guard ioStatus == noErr, let procID else {
            throw AudioTapError.coreAudioError("CreateIOProcID", ioStatus)
        }
        self.ioProcID = procID

        let startStatus = AudioDeviceStart(aggID, procID)
        guard startStatus == noErr else {
            throw AudioTapError.coreAudioError("DeviceStart", startStatus)
        }
        running = true
    }

    func stop() {
        guard running else { return }
        if let procID = ioProcID {
            AudioDeviceStop(aggregateDeviceID, procID)
            AudioDeviceDestroyIOProcID(aggregateDeviceID, procID)
        }
        if aggregateDeviceID != 0 {
            AudioHardwareDestroyAggregateDevice(aggregateDeviceID)
        }
        if tapID != 0 {
            AudioHardwareDestroyProcessTap(tapID)
        }
        running = false
    }

    private func handleInput(_ inputData: UnsafePointer<AudioBufferList>) {
        let buffers = inputData.pointee
        guard buffers.mNumberBuffers > 0 else { return }
        let buf = buffers.mBuffers
        guard let data = buf.mData?.assumingMemoryBound(to: Float.self) else { return }
        let count = Int(buf.mDataByteSize) / MemoryLayout<Float>.size
        let samples = Array(UnsafeBufferPointer(start: data, count: count))
        writer.write(sourceId: id, samples: samples, tsMs: Int64(Date().timeIntervalSince1970 * 1000))
    }

    private func findPID(forBundleId bundleId: String) -> pid_t? {
        NSWorkspace.shared.runningApplications
            .first(where: { $0.bundleIdentifier == bundleId })?
            .processIdentifier
    }
}

// MARK: - Socket writer

final class SocketWriter {
    private var fd: Int32 = -1
    private let lock = NSLock()

    func connect(socketPath: String) throws {
        fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw AudioTapError.socketError("socket()") }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathLen = min(socketPath.utf8.count, 104)
        socketPath.withCString { ptr in
            withUnsafeMutablePointer(to: &addr.sun_path) { dest in
                strncpy(UnsafeMutableRawPointer(dest).assumingMemoryBound(to: CChar.self), ptr, pathLen)
            }
        }
        let addrLen = socklen_t(MemoryLayout<sockaddr_un>.size)
        let result = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                Darwin.connect(fd, sa, addrLen)
            }
        }
        guard result == 0 else { throw AudioTapError.socketError("connect()") }
    }

    func write(sourceId: String, samples: [Float], tsMs: Int64) {
        lock.lock()
        defer { lock.unlock() }
        guard fd >= 0 else { return }

        let idBytes = Array(sourceId.utf8.prefix(63))
        let idLen = UInt8(idBytes.count)
        let headerSize = 13 + Int(idLen)

        var header = Data(count: headerSize)
        header[0] = idLen
        for (i, b) in idBytes.enumerated() { header[1 + i] = b }

        var ts = tsMs.bigEndian
        withUnsafeBytes(of: &ts) { header.replaceSubrange((1 + Int(idLen))..<(9 + Int(idLen)), with: $0) }
        var count = UInt32(samples.count).bigEndian
        withUnsafeBytes(of: &count) { header.replaceSubrange((9 + Int(idLen))..<headerSize, with: $0) }

        var pcmData = Data(count: samples.count * 4)
        for (i, s) in samples.enumerated() {
            var val = s
            withUnsafeBytes(of: &val) { pcmData.replaceSubrange(i * 4..<(i + 1) * 4, with: $0) }
        }

        _ = header.withUnsafeBytes { send(fd, $0.baseAddress, $0.count, 0) }
        _ = pcmData.withUnsafeBytes { send(fd, $0.baseAddress, $0.count, 0) }
    }

    func disconnect() {
        if fd >= 0 { close(fd) }
        fd = -1
    }
}

// MARK: - Errors

enum AudioTapError: Error, CustomStringConvertible {
    case missingBundleId
    case unknownSourceType(String)
    case processNotFound(String)
    case coreAudioError(String, OSStatus)
    case socketError(String)

    var description: String {
        switch self {
        case .missingBundleId: return "Missing bundleId"
        case .unknownSourceType(let t): return "Unknown source type: \(t)"
        case .processNotFound(let b): return "Process not found: \(b)"
        case .coreAudioError(let op, let s): return "CoreAudio \(op) failed: \(s)"
        case .socketError(let op): return "Socket \(op) failed"
        }
    }
}

// MARK: - Main

@available(macOS 14.2, *)
@main
struct AudioTapMain {
    static func main() {
        var manager: AudioSourceManager?
        var writer: SocketWriter?

        emit(type: "ready")

        let stdin = FileHandle.standardInput
        while true {
            let data = stdin.availableData
            guard !data.isEmpty,
                  let line = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !line.isEmpty else {
                Thread.sleep(forTimeInterval: 0.05)
                continue
            }

            guard let lineData = line.data(using: .utf8),
                  let cmd = try? JSONDecoder().decode(SidecarCommand.self, from: lineData) else { continue }

            switch cmd.cmd {
            case "start":
                if let path = cmd.socketPath {
                    let w = SocketWriter()
                    try? w.connect(socketPath: path)
                    writer = w
                    manager = AudioSourceManager(socketWriter: w)
                }
            case "add":
                if let source = cmd.source, let sourceId = cmd.sourceId {
                    try? manager?.addSource(id: sourceId, spec: source)
                }
            case "remove":
                if let sourceId = cmd.sourceId {
                    manager?.removeSource(id: sourceId)
                }
            case "stop":
                manager?.stopAll()
                writer?.disconnect()
                emit(type: "stopped")
            case "ping":
                emit(type: "pong")
            default:
                break
            }
        }
    }

    static func emit(type: String) {
        let dict = ["type": type]
        if let data = try? JSONSerialization.data(withJSONObject: dict),
           let line = String(data: data, encoding: .utf8) {
            FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
        }
    }
}
