# Copy Sound

A quiet click when you copy, using the bundled `assets/click.wav` sound.
macOS only; built for Clipbus 3, plugin protocol V2 (SDK 3.2 / manifest schema 6).
Requires macOS Clipbus with support for `system.playSound` and per-sound volume; targets Clipbus 3.2.1.

## Install

1. In Clipbus, open **Settings → Plugins → Install → Git Repository**.
2. Set **Repository URL** to `https://github.com/MuhametSmaili/clipbus-plugins`.
3. Set **Subdirectory** to `sound-plugin`. Leave **Ref** blank for the default branch, or specify a branch, tag, or commit.
4. Click **Install** and approve the Node install hook. It runs `npm ci --include=dev --ignore-scripts` against the committed lockfile, then explicitly builds the plugin. No manual build is needed.
5. Enable **Copy Sound** and its **Copy Sound Detector** in the detector settings.
6. Copy some text or an image. Wait at least a second before testing a repeat copy.

For a local checkout, use the [development instructions](#develop).

If Clipbus's free-tier detector limit prevents enabling it, disable an unused plugin detector first.

## Behavior

- Requests the bundled 40 ms click through Clipbus's native `ctx.system.playSound` API at 25% linear gain by default, respecting system volume/mute without changing system volume.
- Runs only for new copies and repeat copies, not edits or manual re-detection. macOS only.
- Adds no cards, tags, actions, clipboard writes or folder permissions. No network requests or child processes at runtime.
- Awaits the Host's playback-start response, not the end of playback. A successful request does not guarantee audible output.
- Clipbus shares one playback slot and a minimum one-second interval across all plugins. Unsupported, busy or rate-limited requests are silently skipped, not queued or retried. Rapid copies may produce no sound. Other failures go to the plugin log without clipboard contents, custom paths or raw error messages.
- A rejected custom audio file selects the bundled click **on the next copy**, not immediately: even a rejected request consumes the Host's admission interval. Reload the plugin to retry the repaired custom file, or change the configured path. Restarting the plugin process also resets this fallback.
- Only copies Clipbus dispatches to this detector can produce sound. Ignored apps, unsupported clipboard types, oversized items or host-coalesced events may not trigger it. This is not a system-wide keyboard listener.

## Custom sound and volume

No configuration is required. To customize volume, add this key to Clipbus's shared settings file, preserving existing settings:

```text
~/Library/Application Support/Clipbus/ExternalSettings/settings.json
```

```json
{
  "plugin.clipbus.sound.volume": 0.25
}
```

Reload the plugin or restart Clipbus after saving. No rebuild is needed for settings-only changes. Debug builds use `ClipbusDebug` instead of `Clipbus` in the settings-file path.

| Setting                          | Default                    | Accepted values                                                                                                                                   |
| -------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin.clipbus.sound.soundPath` | `package/assets/click.wav` | A plugin-package path beginning with `package/`, with no empty, `.` or `..` segments, backslashes or control characters; maximum 1024 UTF-8 bytes |
| `plugin.clipbus.sound.volume`    | `0.25`                     | A JSON number from `0` (mute) to `1` (full gain), rounded to an integer percentage                                                                |

For a custom sound, add a regular file such as `assets/custom.wav` to your **local development checkout or fork**, then set:

```json
{
  "plugin.clipbus.sound.soundPath": "package/assets/custom.wav",
  "plugin.clipbus.sound.volume": 0.4
}
```

Use PCM16 WAV, classic PCM16 AIFF (not AIFC), or MP3: mono/stereo, 8–48 kHz, nonempty, at most 3 seconds and 1 MiB. The Host checks file content, not just the extension, and rejects symlinks and multi-hard-linked files. WAV is recommended for copy feedback. Do not edit the managed package of a Git-installed plugin: updates replace it. A fork distributes any audio committed to it; include only files you have permission to redistribute.

Unset or invalid settings use defaults. Remove `soundPath` to return to the bundled click.

## Develop

Requires Node.js 18+ and npm. Run from this repository's `sound-plugin` folder:

```sh
npm ci --ignore-scripts
npm run verify
```

`verify` validates the manifest, typechecks, bundles the runtime and SDK into `dist/plugin.cjs`, checks runtime file paths, and runs tests with a fake Host. These tests do not prove native Host playback, sandbox enforcement or actual clipboard dispatch.

In Clipbus, open **Settings → Plugins → Developer Plugins → Add Path** and select the `sound-plugin` folder containing `manifest.json`, not the repository root. Approve the install hook, then enable the plugin and its detector.

After source changes, run `npm run build` to refresh the files Clipbus loads. Use **Reload** after rebuilding or changing the manifest, and **Run Install** to rerun the development plugin's install hook if needed. Installation can use child processes and the network; runtime cannot.

The original `assets/click.aiff` is retained as source audio. Its PCM16 WAV conversion is committed so installation needs no macOS audio tools. To regenerate it on macOS:

```sh
afconvert -f WAVE -d LEI16 assets/click.aiff assets/click.wav
```
