# Clipbus Plugins

A collection of independent plugins for [Clipbus](https://clipbus.com).

| Plugin                               | Description                                                   | Install subdirectory | Platform |
| ------------------------------------ | ------------------------------------------------------------- | -------------------- | -------- |
| [Copy Sound](sound-plugin/README.md) | A quiet WAV click on copy, with mute and packaged custom audio. | `sound-plugin`       | macOS (Clipbus 3.1+) |

## Install a plugin

1. In Clipbus, open **Settings → Plugins → Install → Git Repository**.
2. Set **Repository URL** to `https://github.com/MuhametSmaili/clipbus-plugins`.
3. Set **Subdirectory** to the plugin's install subdirectory from the table above.
4. Leave **Ref** blank to use the default branch, or enter a specific branch, tag, or commit.
5. Click **Install**, then enable the plugin and its detector in Clipbus's detector settings.

Clipbus runs the plugin's install hook to install dependencies and build it. Normal installation does not require a manual clone or build. See each plugin's README for configuration, requirements, and limitations.

## Development

Each plugin folder contains its own `manifest.json`, dependencies, build, tests, and documentation. There is no shared root package or build step.

For Copy Sound, run these commands from `sound-plugin/`:

```sh
npm ci --ignore-scripts
npm run verify
```

To load a local build, use **Settings → Plugins → Developer Plugins → Add Path** and select the plugin folder containing `manifest.json`, not the repository root. Follow the [Copy Sound development instructions](sound-plugin/README.md#develop).
