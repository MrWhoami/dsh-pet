# Native dependency: libwebpdecoder.dll

`libwebpdecoder.dll` is the WebP image decoder from
[libwebp](https://chromium.googlesource.com/webm/libwebp), version 1.6.0
(reported by `WebPGetDecoderVersion`).

- License: BSD-3-Clause, Copyright (c) Google Inc. / WebM Project.
- Used unmodified, only through `WebPDecodeBGRA`, `WebPGetInfo` and
  `WebPFree` (see `../LibWebP.cs`).
- Why: WPF's Windows WebP codec composes these atlases to `Bgr32` and drops
  the alpha channel, which turns the transparent pet into a black rectangle.
  libwebp returns straight BGRA and preserves alpha.
- This binary is for the desktop companion spike and is **not** part of the npm
  package. A distribution must pin the build and ship the libwebp license text
  alongside it.

The DLL was copied from `C:\Program Files\FreeCAD 1.1\bin\libwebpdecoder.dll`
on the development machine. Its PE metadata carries no version resource; the
runtime version is read through `WebPGetDecoderVersion()` and logged by the
companion (`webp=1.6.0`).
