// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "audio-tap",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "audio-tap", targets: ["AudioTap"]),
    ],
    targets: [
        .executableTarget(
            name: "AudioTap",
            path: "Sources/AudioTap"
        ),
    ]
)
