# S213 — One scan of a file's bytes finds a location in JPEG, PNG, WebP and HEIC, from EXIF's GPS latitude or XMP's, agreeing with exiftool on 17 files

- **Status:** Answered
- **Led to:** ADR-0151

**Question.** A shared original keeps its location data, and its chip
warns when it holds one (decision 8 of the file-shares plan). HEIC, the
format phones write locations into most, is an opaque blob here (pi
cannot decode it), so the check cannot lean on an image decoder.

1. Can one pure function over the bytes say whether a file holds a
   location, whatever its container?
2. Does it agree with exiftool, including a GPS block with no position in
   it and a location written only in XMP?
3. What does it cost on an upload of `MAX_UPLOAD_BYTES`?

**Kill criterion.** A container that carries locations needs a parser of
its own, or the scan disagrees with exiftool on a real file.

**Throw away.** `sandbox/s205-location/scan.ts` (the scan, and a run over
a folder against `exiftool -GPSLatitude`) and `sandbox/s205-location/perf.ts`.
Samples were downloaded to `/tmp/s205`: exiftool's own test images
(`t/images` in its repository), `ianare/exif-samples`' `DSCN0010.jpg` and
`Canon_40D.jpg`, and libheif's `examples/example.heic`. The positives in
PNG, WebP, HEIC and XMP alone, and a GPS block holding only its version,
were written by exiftool 13.25 onto copies of those.

## Answers

1. **Yes.** EXIF is a TIFF structure, embedded as it is by every container
   that carries it: JPEG's APP1, PNG's `eXIf`, WebP's `EXIF` chunk and
   HEIC's `Exif` item. The scan finds each TIFF header (`II*\0` or
   `MM\0*`), reads IFD0 within bounds for the GPS pointer (tag `0x8825`)
   and that IFD for a latitude (tag `0x0002`); and it looks for
   `GPSLatitude` in the bytes, which is how XMP writes one
   (`exif:GPSLatitude`).
2. **It agreed on all 17:** 9 with a location (5 camera and phone JPEGs,
   PNG, WebP, HEIC, and a JPEG with XMP alone) and 8 without
   (`Canon_40D.jpg`, a GeoTIFF, PNG, WebP, two HEICs, an XMP JPEG with no
   GPS, and a JPEG whose GPS block holds only `GPSVersionID`, which places
   no one and so warns of nothing). A GeoTIFF's map georeferencing
   is not a GPS block, and is not counted.
3. **87 ms over 32 MiB** of random bytes, the worst case (nothing found,
   every byte read); 3.5 ms over the 718 kB HEIC.

**Not covered.** A location in a container that compresses its metadata
(a zipped document's, a video's `©xyz` atom) is not found; those are
opaque files, and their chip makes no claim either way.

**For the plan.** `classifyBlob` decides `hasLocation` with this scan, for
every kind, at upload: a pure function of the bytes, so it follows the
sha as the kind does. The chip's warning comes from the stored ref, and
says it holds a location; it never claims a file has none.
