> [!WARNING]
> This is very much in beta and might be buggy here and there (but hope you have a good experience!).

<p align="center">
  <img src="public/openscreen.png" alt="OpenScreen Logo" width="64" />
  <br />
  <br />
  <a href="https://deepwiki.com/siddharthvaddem/openscreen">
    <img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" />
  </a>
  &nbsp;
  <a href="https://discord.gg/yAQQhRaEeg">
    <img src="https://img.shields.io/discord/pHAUbcqNd?logo=discord&label=Discord&color=5865F2" alt="Join Discord" />
  </a>
</p>

# <p align="center">Docsie Screen Recorder</p>

<p align="center"><strong>A free screen recorder built on OpenScreen, with Docsie ecosystem enterprise extensions.</strong></p>

Docsie Screen Recorder is the public Docsie fork of OpenScreen. The goal is simple:

- keep a strong free recorder and editor available in the open
- build Docsie-specific enterprise features around documentation, workflows, AI, and the broader Docsie ecosystem

This is not trying to erase the upstream project. The recorder/editor foundation comes from OpenScreen, while Docsie-specific extensions are being layered on top with a separate enterprise boundary.

<p align="center">
	<img src="public/preview3.png" alt="OpenScreen App Preview 3" style="height: 0.2467; margin-right: 12px;" />
	<img src="public/preview4.png" alt="OpenScreen App Preview 4" style="height: 0.1678; margin-right: 12px;" />
</p>

## Docsie Fork

This repository is the **public Docsie Screen Recorder fork** used for local recording, editing, and Docsie's existing Video-to-Docs workflow.

- Public fork repo: [LikaloLLC/docsie-screen-recorder](https://github.com/LikaloLLC/docsie-screen-recorder)
- Upstream source: [siddharthvaddem/openscreen](https://github.com/siddharthvaddem/openscreen)
- Current desktop auth notes: [DOCSIE_DESKTOP_AUTH.md](./DOCSIE_DESKTOP_AUTH.md)
- Current editor/integration notes: [CLAUDE.md](./CLAUDE.md)
- Mixed-license notes: [LICENSING.md](./LICENSING.md)
- Release process: [RELEASING.md](./RELEASING.md)

### Docsie Quick Start

Recommended local runtime:

- Node `22.22.1`
- npm `10.9.4`

Install and run locally:

```bash
npm install
npm run dev
```

Build the macOS app:

```bash
npm run build:mac
```

Useful output paths after a mac build:

- Apple Silicon app bundle: `release/1.3.0/mac-arm64/Docsie - Screen Recorder.app`
- Intel app bundle: `release/1.3.0/mac/Docsie - Screen Recorder.app`
- DMGs: `release/1.3.0/*.dmg`

Create a tagged multi-platform release:

```bash
npm run release:tag
```

That triggers the GitHub Actions release workflow, which builds Windows, Linux, and macOS installers on native runners and publishes them to GitHub Releases. Optional S3 mirroring is documented in [RELEASING.md](./RELEASING.md).

### macOS Permission Flow

If the app opens but shows `Screens (0)` and `Windows (0)`, macOS screen capture permission is still blocked.

1. Launch the app once.
2. In the source picker, click `Open Settings`.
3. Enable `Docsie - Screen Recorder` in `System Settings -> Privacy & Security -> Screen & System Audio Recording`.
4. Fully quit the app.
5. Reopen it.

If Gatekeeper blocks the app on first launch, remove quarantine and retry:

```bash
xattr -dr com.apple.quarantine "release/1.3.0/mac-arm64/Docsie - Screen Recorder.app"
```

### Licensing Model

This fork is **not** relicensing the inherited upstream project.

- The root project and inherited OpenScreen code remain under the upstream
  [MIT License](./LICENSE).
- New Docsie-only enterprise work should go under [enterprise/](./enterprise/)
  and is intended to follow [enterprise/LICENSE.md](./enterprise/LICENSE.md).

This is the same general repository pattern used by mixed-license/source-available
projects: keep the original open-source base intact, and place separately
licensed commercial extensions behind a clear directory boundary.

## Core Features
- Record specific windows or your whole screen.
- Add automatic or manual zooms (adjustable depth levels) and customize their durarion and position.
- Record microphone and system audio.
- Crop video recordings to hide parts.
- Choose between wallpapers, solid colors, gradients or a custom background.
- Motion blur for smoother pan and zoom effects.
- Add annotations (text, arrows, images).
- Trim sections of the clip.
- Customize the speed of different segments.
- Export in different aspect ratios and resolutions.

## Installation

For the Docsie fork, use the packaged builds under `release/<version>/` in this repo or the releases attached to the private fork.

If you are developing locally, prefer the `Docsie Quick Start` section above instead of the packaged installers.

### macOS

If you encounter issues with macOS Gatekeeper blocking the app (the current build is not Developer ID signed or notarized), you can bypass this by running the following command in your terminal after installation:

```bash
xattr -rd com.apple.quarantine /Applications/Docsie\ -\ Screen\ Recorder.app
```

Note: Give your terminal Full Disk Access in **System Settings > Privacy & Security** to grant you access and then run the above command.

After running this command, proceed to **System Settings > Privacy & Security** to grant the necessary permissions for **Screen & System Audio Recording**. Once permissions are granted, fully quit and relaunch the app.

### Linux

Download the `.AppImage` file from the releases page. Make it executable and run:

```bash
chmod +x Openscreen-Linux-*.AppImage
./Openscreen-Linux-*.AppImage
```

You may need to grant screen recording permissions depending on your desktop environment.

**Note:** If the app fails to launch due to a "sandbox" error, run it with --no-sandbox:
```bash
./Openscreen-Linux-*.AppImage --no-sandbox
```

### Limitations

System audio capture relies on Electron's [desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) and has some platform-specific quirks:

- **macOS**: Requires macOS 13+. On macOS 14.2+ you'll be prompted to grant audio capture permission. macOS 12 and below does not support system audio (mic still works).
- **Windows**: Works out of the box.
- **Linux**: Needs PipeWire (default on Ubuntu 22.04+, Fedora 34+). Older PulseAudio-only setups may not support system audio (mic should still work).

## Built with
- Electron
- React
- TypeScript
- Vite
- PixiJS
- dnd-timeline

---

_I'm new to open source, idk what I'm doing lol. If something is wrong please raise an issue 🙏_

## Documentation

Repo-specific docs:

- [CLAUDE.md](./CLAUDE.md)
- [DOCSIE_DESKTOP_AUTH.md](./DOCSIE_DESKTOP_AUTH.md)
- [LICENSING.md](./LICENSING.md)
- [RELEASING.md](./RELEASING.md)

Upstream background docs:
[OpenScreen Docs](https://deepwiki.com/siddharthvaddem/openscreen)

## Contributing

Contributions are welcome! If you’d like to help out or see what’s currently being worked on, take a look at the open issues and the [project roadmap](https://github.com/users/siddharthvaddem/projects/3) to understand the current direction of the project and find ways to contribute.

## License

This repository uses a mixed-license structure.

- The inherited OpenScreen codebase and default root code remain under the
  [MIT License](./LICENSE).
- Docsie-only enterprise code under [enterprise/](./enterprise/) is intended to
  follow [enterprise/LICENSE.md](./enterprise/LICENSE.md).

Read [LICENSING.md](./LICENSING.md) before moving code across those boundaries.
