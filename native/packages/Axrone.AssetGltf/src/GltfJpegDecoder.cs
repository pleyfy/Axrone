namespace Axrone.AssetGltf;

/// <summary>Chroma upsampling strategy for subsampled JPEG scans.</summary>
public enum GltfJpegChromaUpsampling : byte
{
    /// <summary>Nearest-neighbour replication; every output sample maps to one stored chroma sample.</summary>
    Nearest = 0,

    /// <summary>Bilinear filtering with fixed-point Q8 weights.</summary>
    Bilinear = 1,
}

/// <summary>
/// Baseline sequential JPEG decoder producing tightly packed RGBA8. Supports SOI/APPn/DQT/SOF0/
/// DHT/DRI/SOS/EOI, 8-bit precision, one or three components and Huffman-coded sequential scans.
/// Progressive, extended-sequential, lossless, arithmetic-coded and 12-bit streams are rejected
/// with a typed diagnostic. Identical input always produces identical output bytes.
/// </summary>
public static class GltfJpegDecoder
{
    private const int MaxDimension = 8192;
    private const long MaxPixels = 32L * 1024 * 1024;
    private const byte MarkerSoi = 0xD8;
    private const byte MarkerEoi = 0xD9;
    private const byte MarkerSos = 0xDA;
    private const byte MarkerDri = 0xDD;
    private const byte MarkerDnl = 0xDC;
    private const byte MarkerDht = 0xC4;
    private const byte MarkerDqt = 0xDB;
    private const byte MarkerDac = 0xCC;
    private const byte MarkerSof0 = 0xC0;

    private const int LumaRed = 91881;
    private const int LumaGreenCb = 22554;
    private const int LumaGreenCr = 46802;
    private const int LumaBlue = 116130;

    private static ReadOnlySpan<byte> ZigZag =>
    [
        0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
        12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
        35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
        58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
    ];

    private static readonly double[] IdctCosine = CreateIdctCosine();

    /// <summary>Whether the buffer starts with the JPEG SOI marker.</summary>
    /// <param name="data">Candidate bytes.</param>
    public static bool IsJpeg(ReadOnlySpan<byte> data) =>
        data.Length >= 2 && data[0] == 0xFF && data[1] == MarkerSoi;

    /// <summary>Decodes a baseline JPEG buffer into RGBA8.</summary>
    /// <param name="jpeg">JPEG bytes.</param>
    /// <param name="image">Decoded image.</param>
    /// <param name="error">Typed failure diagnostic, including the marker where decoding stopped.</param>
    /// <param name="upsampling">Chroma upsampling strategy for subsampled scans.</param>
    /// <returns>Whether the buffer decoded successfully.</returns>
    public static bool TryDecode(
        ReadOnlySpan<byte> jpeg,
        [NotNullWhen(true)] out GltfDecodedImage? image,
        out GltfImageDecodeError? error,
        GltfJpegChromaUpsampling upsampling = GltfJpegChromaUpsampling.Nearest)
    {
        image = null;
        bool ok = TryDecodeCore(
            jpeg,
            Span<byte>.Empty,
            stride: 0,
            allocateOutput: true,
            upsampling,
            out byte[]? rgba,
            out int width,
            out int height,
            out error);
        if (!ok)
        {
            return false;
        }

        image = new GltfDecodedImage
        {
            Width = width,
            Height = height,
            Rgba = rgba!,
        };
        return true;
    }

    /// <summary>Decodes a baseline JPEG into a caller-provided RGBA8 buffer.</summary>
    /// <param name="jpeg">JPEG bytes.</param>
    /// <param name="destination">RGBA8 destination; rows start every <paramref name="stride"/> bytes.</param>
    /// <param name="stride">Destination row stride in bytes; must be at least <c>width * 4</c>.</param>
    /// <param name="width">Decoded pixel width.</param>
    /// <param name="height">Decoded pixel height.</param>
    /// <param name="error">Typed failure diagnostic.</param>
    /// <param name="upsampling">Chroma upsampling strategy for subsampled scans.</param>
    /// <returns>Whether the buffer decoded successfully.</returns>
    public static bool TryDecode(
        ReadOnlySpan<byte> jpeg,
        Span<byte> destination,
        int stride,
        out int width,
        out int height,
        out GltfImageDecodeError? error,
        GltfJpegChromaUpsampling upsampling = GltfJpegChromaUpsampling.Nearest) =>
        TryDecodeCore(
            jpeg,
            destination,
            stride,
            allocateOutput: false,
            upsampling,
            out _,
            out width,
            out height,
            out error);

    private static bool TryDecodeCore(
        ReadOnlySpan<byte> jpeg,
        Span<byte> destination,
        int stride,
        bool allocateOutput,
        GltfJpegChromaUpsampling upsampling,
        out byte[]? allocated,
        out int width,
        out int height,
        out GltfImageDecodeError? error)
    {
        allocated = null;
        width = 0;
        height = 0;
        error = null;

        Span<int> quant = stackalloc int[4 * 64];
        Span<byte> quantPresent = stackalloc byte[4];
        Span<byte> huffmanCounts = stackalloc byte[8 * 16];
        Span<byte> huffmanSymbols = stackalloc byte[8 * 256];
        Span<int> huffmanMinCode = stackalloc int[8 * 17];
        Span<int> huffmanMaxCode = stackalloc int[8 * 17];
        Span<int> huffmanValuePointer = stackalloc int[8 * 17];
        Span<byte> huffmanPresent = stackalloc byte[8];
        Span<byte> componentId = stackalloc byte[4];
        Span<byte> componentH = stackalloc byte[4];
        Span<byte> componentV = stackalloc byte[4];
        Span<byte> componentQuant = stackalloc byte[4];
        Span<byte> scanComponent = stackalloc byte[4];
        Span<byte> scanDcTable = stackalloc byte[4];
        Span<byte> scanAcTable = stackalloc byte[4];
        Span<int> dcPredictor = stackalloc int[4];
        Span<int> planeWidth = stackalloc int[3];
        Span<int> planeHeight = stackalloc int[3];
        Span<int> planeStride = stackalloc int[3];
        Span<int> coefficients = stackalloc int[64];
        Span<double> idctTemporary = stackalloc double[64];
        Span<byte> blockSamples = stackalloc byte[64];

        quant.Fill(-1);
        quantPresent.Clear();
        huffmanCounts.Clear();
        huffmanSymbols.Clear();
        huffmanMinCode.Clear();
        huffmanMaxCode.Clear();
        huffmanValuePointer.Clear();
        huffmanPresent.Clear();
        componentId.Clear();
        componentH.Clear();
        componentV.Clear();
        componentQuant.Clear();
        scanComponent.Clear();
        scanDcTable.Clear();
        scanAcTable.Clear();
        dcPredictor.Clear();
        planeWidth.Clear();
        planeHeight.Clear();
        planeStride.Clear();
        coefficients.Clear();
        idctTemporary.Clear();
        blockSamples.Clear();

        scoped var decoder = default(JpegDecoder);
        decoder._data = jpeg;
        decoder._quant = quant;
        decoder._quantPresent = quantPresent;
        decoder._huffmanCounts = huffmanCounts;
        decoder._huffmanSymbols = huffmanSymbols;
        decoder._huffmanMinCode = huffmanMinCode;
        decoder._huffmanMaxCode = huffmanMaxCode;
        decoder._huffmanValuePointer = huffmanValuePointer;
        decoder._huffmanPresent = huffmanPresent;
        decoder._componentId = componentId;
        decoder._componentH = componentH;
        decoder._componentV = componentV;
        decoder._componentQuant = componentQuant;
        decoder._scanComponent = scanComponent;
        decoder._scanDcTable = scanDcTable;
        decoder._scanAcTable = scanAcTable;
        decoder._dcPredictor = dcPredictor;
        decoder._planeWidth = planeWidth;
        decoder._planeHeight = planeHeight;
        decoder._planeStride = planeStride;
        decoder._coefficients = coefficients;
        decoder._idctTemporary = idctTemporary;
        decoder._samples = blockSamples;

        try
        {
            decoder.Run(destination, stride, allocateOutput, upsampling, out allocated);
            width = decoder.Width;
            height = decoder.Height;
            return true;
        }
        catch (JpegFailureException failure)
        {
            allocated = null;
            error = new GltfImageDecodeError(
                GltfImageCodecKind.Jpeg,
                failure.Failure,
                failure.Message,
                failure.Marker);
            return false;
        }
        catch (Exception exception) when (
            exception is OverflowException or IndexOutOfRangeException or ArgumentException or InvalidOperationException)
        {
            allocated = null;
            error = new GltfImageDecodeError(
                GltfImageCodecKind.Jpeg,
                GltfImageDecodeFailure.ScanData,
                $"JPEG entropy decode failed: {exception.Message}",
                null);
            return false;
        }
    }

    private static double[] CreateIdctCosine()
    {
        double[] table = new double[64];
        for (int frequency = 0; frequency < 8; frequency++)
        {
            double scale = frequency == 0 ? 1.0 / Math.Sqrt(2.0) : 1.0;
            for (int position = 0; position < 8; position++)
            {
                table[(frequency * 8) + position] = scale *
                    Math.Cos((((2.0 * position) + 1.0) * frequency * Math.PI) / 16.0);
            }
        }

        return table;
    }

    private static void ThrowFailure(
        GltfImageDecodeFailure failure,
        string message,
        string? marker,
        int offset) =>
        throw new JpegFailureException(failure, message, marker, offset);

    private static void ThrowTruncated(string marker, int offset) =>
        ThrowFailure(
            GltfImageDecodeFailure.Truncated,
            $"JPEG payload ended before the {marker} marker at offset {offset}.",
            marker,
            offset);

    private static void ThrowMarker(string marker, int offset, string message) =>
        ThrowFailure(GltfImageDecodeFailure.Marker, message, marker, offset);

    private static void ThrowScan(string marker, int offset, string message) =>
        ThrowFailure(GltfImageDecodeFailure.ScanData, message, marker, offset);

    private static void ThrowUnsupported(string marker, int offset, string message) =>
        ThrowFailure(GltfImageDecodeFailure.Unsupported, message, marker, offset);

    private static void ThrowLimit(string message, int offset) =>
        ThrowFailure(GltfImageDecodeFailure.LimitExceeded, message, null, offset);

    private static string MarkerName(byte marker) => marker switch
    {
        0xC0 => "SOF0",
        0xC1 => "SOF1",
        0xC2 => "SOF2",
        0xC3 => "SOF3",
        0xC4 => "DHT",
        0xC5 => "SOF5",
        0xC6 => "SOF6",
        0xC7 => "SOF7",
        0xC8 => "JPG",
        0xC9 => "SOF9",
        0xCA => "SOF10",
        0xCB => "SOF11",
        0xCC => "DAC",
        0xCD => "SOF13",
        0xCE => "SOF14",
        0xCF => "SOF15",
        0xD0 => "RST0",
        0xD1 => "RST1",
        0xD2 => "RST2",
        0xD3 => "RST3",
        0xD4 => "RST4",
        0xD5 => "RST5",
        0xD6 => "RST6",
        0xD7 => "RST7",
        0xD8 => "SOI",
        0xD9 => "EOI",
        0xDA => "SOS",
        0xDB => "DQT",
        0xDC => "DNL",
        0xDD => "DRI",
        0xFE => "COM",
        >= 0xE0 and <= 0xEF => "APPn",
        _ => "0x" + marker.ToString("X2", CultureInfo.InvariantCulture),
    };

    private enum SofKind : byte
    {
        None = 0,
        Baseline = 1,
        Unsupported = 2,
    }

    private static SofKind ClassifySof(byte marker, out string reason) => marker switch
    {
        0xC0 => SetReason(out reason, string.Empty, SofKind.Baseline),
        0xC1 => SetReason(out reason, "extended sequential (SOF1)", SofKind.Unsupported),
        0xC2 => SetReason(out reason, "progressive DCT (SOF2)", SofKind.Unsupported),
        0xC3 => SetReason(out reason, "lossless (SOF3)", SofKind.Unsupported),
        0xC5 or 0xC6 or 0xC7 => SetReason(out reason, "differential sequential/lossless", SofKind.Unsupported),
        0xC9 => SetReason(out reason, "extended sequential arithmetic coding (SOF9)", SofKind.Unsupported),
        0xCA => SetReason(out reason, "progressive arithmetic coding (SOF10)", SofKind.Unsupported),
        0xCB => SetReason(out reason, "lossless arithmetic coding (SOF11)", SofKind.Unsupported),
        0xCD or 0xCE or 0xCF => SetReason(out reason, "differential arithmetic coding", SofKind.Unsupported),
        _ => SetReason(out reason, string.Empty, SofKind.None),
    };

    private static SofKind SetReason(out string reason, string text, SofKind kind)
    {
        reason = text;
        return kind;
    }

    [SuppressMessage(
        "Design",
        "CA1064:Exceptions should be public",
        Justification = "Internal control-flow exception; the decoder surface returns typed diagnostics.")]
    private sealed class JpegFailureException : Exception
    {
        public JpegFailureException(
            GltfImageDecodeFailure failure,
            string message,
            string? marker,
            int offset)
            : base($"{message} (offset {offset})")
        {
            Failure = failure;
            Marker = marker;
        }

        public GltfImageDecodeFailure Failure { get; }

        public string? Marker { get; }
    }

    private ref struct BitReader
    {
        private readonly ReadOnlySpan<byte> _data;
        private int _position;
        private int _buffer;
        private int _bits;

        public BitReader(ReadOnlySpan<byte> data, int offset)
        {
            _data = data;
            _position = offset;
            _buffer = 0;
            _bits = 0;
        }

        public int ReadBit()
        {
            if (_bits == 0)
            {
                Refill();
            }

            _bits--;
            return (_buffer >> _bits) & 1;
        }

        public int ReadBits(int count)
        {
            int value = 0;
            for (int i = 0; i < count; i++)
            {
                value = (value << 1) | ReadBit();
            }

            return value;
        }

        public void ExpectRestart(int index)
        {
            _bits = 0;
            int position = _position;
            while ((uint)(position + 1) < (uint)_data.Length &&
                   _data[position] == 0xFF &&
                   _data[position + 1] == 0xFF)
            {
                position++;
            }

            if ((uint)(position + 1) >= (uint)_data.Length)
            {
                ThrowTruncated($"RST{index & 7}", position);
            }

            if (_data[position] != 0xFF)
            {
                ThrowMarker(
                    $"RST{index & 7}",
                    position,
                    "Restart interval ended without a restart marker.");
            }

            byte marker = _data[position + 1];
            if (marker != 0xD0 + (index & 7))
            {
                ThrowScan(
                    MarkerName(marker),
                    position,
                    $"Expected restart marker RST{index & 7} but found {MarkerName(marker)}.");
            }

            _position = position + 2;
            _buffer = 0;
        }

        public int EndOfScanPosition()
        {
            _bits = 0;
            int position = _position;
            if ((uint)position >= (uint)_data.Length)
            {
                ThrowTruncated("EOI", position);
            }

            if (_data[position] != 0xFF)
            {
                ThrowMarker(
                    "EOI",
                    position,
                    "Entropy-coded scan contains trailing bytes before the next marker.");
            }

            return position;
        }

        private void Refill()
        {
            int position = _position;
            if ((uint)position >= (uint)_data.Length)
            {
                ThrowTruncated("scan data", position);
            }

            int value = _data[position];
            if (value == 0xFF)
            {
                if ((uint)(position + 1) >= (uint)_data.Length)
                {
                    ThrowTruncated("scan data", position);
                }

                int next = _data[position + 1];
                if (next == 0x00)
                {
                    _position = position + 2;
                    _buffer = 0xFF;
                    _bits = 8;
                    return;
                }

                ThrowScan(
                    MarkerName((byte)next),
                    position,
                    $"Entropy-coded scan ended at {MarkerName((byte)next)} before every MCU was decoded.");
            }

            _position = position + 1;
            _buffer = value;
            _bits = 8;
        }
    }

    private ref struct JpegDecoder
    {
        internal ReadOnlySpan<byte> _data;
        internal int _offset;
        internal bool _frameSeen;
        internal bool _scanSeen;
        internal int _width;
        internal int _height;
        internal int _componentCount;
        internal int _maxH;
        internal int _maxV;
        internal int _mcuCols;
        internal int _mcuRows;
        internal int _restartInterval;
        internal int _scanComponentCount;
        internal Span<int> _quant;
        internal Span<byte> _quantPresent;
        internal Span<byte> _huffmanCounts;
        internal Span<byte> _huffmanSymbols;
        internal Span<int> _huffmanMinCode;
        internal Span<int> _huffmanMaxCode;
        internal Span<int> _huffmanValuePointer;
        internal Span<byte> _huffmanPresent;
        internal Span<byte> _componentId;
        internal Span<byte> _componentH;
        internal Span<byte> _componentV;
        internal Span<byte> _componentQuant;
        internal Span<byte> _scanComponent;
        internal Span<byte> _scanDcTable;
        internal Span<byte> _scanAcTable;
        internal Span<int> _dcPredictor;
        internal Span<int> _planeWidth;
        internal Span<int> _planeHeight;
        internal Span<int> _planeStride;
        internal Span<int> _coefficients;
        internal Span<double> _idctTemporary;
        internal Span<byte> _samples;

        public int Width => _width;

        public int Height => _height;

        public void Run(
            Span<byte> destination,
            int stride,
            bool allocateOutput,
            GltfJpegChromaUpsampling upsampling,
            out byte[]? allocated)
        {
            allocated = null;
            if (_data.Length < 2 || _data[0] != 0xFF || _data[1] != MarkerSoi)
            {
                ThrowFailure(
                    GltfImageDecodeFailure.Signature,
                    "JPEG SOI marker is missing.",
                    "SOI",
                    0);
            }

            _offset = 2;
            while (true)
            {
                byte marker = NextMarker();
                if (marker == MarkerEoi)
                {
                    if (!_scanSeen)
                    {
                        ThrowMarker("EOI", _offset, "JPEG EOI marker appeared before any scan.");
                    }

                    return;
                }

                ReadOnlySpan<byte> segment = ReadSegment(marker);
                SofKind sofKind = ClassifySof(marker, out string sofReason);
                if (sofKind == SofKind.Unsupported)
                {
                    ThrowUnsupported(
                        MarkerName(marker),
                        _offset,
                        $"JPEG {sofReason} is unsupported; only baseline sequential 8-bit Huffman JPEG is supported.");
                }

                switch (marker)
                {
                    case MarkerSof0:
                        ParseFrame(segment);
                        break;
                    case MarkerDqt:
                        ParseQuantTables(segment);
                        break;
                    case MarkerDht:
                        ParseHuffmanTables(segment);
                        break;
                    case MarkerDri:
                        ParseRestartInterval(segment);
                        break;
                    case MarkerSos:
                        if (_scanSeen)
                        {
                            ThrowUnsupported(
                                "SOS",
                                _offset,
                                "Multiple JPEG scans are unsupported; only a single interleaved baseline scan is supported.");
                        }

                        if (!_frameSeen)
                        {
                            ThrowMarker("SOS", _offset, "JPEG scan header appeared before the frame header.");
                        }

                        ParseScan(segment);
                        DecodeScan(destination, stride, allocateOutput, upsampling, out allocated);
                        break;
                    case MarkerDac:
                        ThrowUnsupported(
                            "DAC",
                            _offset,
                            "JPEG arithmetic coding is unsupported; only Huffman-coded baseline scans are supported.");
                        break;
                    case MarkerDnl:
                        ThrowUnsupported(
                            "DNL",
                            _offset,
                            "JPEG DNL-defined heights are unsupported; the frame header must carry the height.");
                        break;
                    default:
                        if (marker is >= 0xE0 and <= 0xEF or 0xFE)
                        {
                            break;
                        }

                        if (marker is >= 0xC0 and <= 0xCF)
                        {
                            ThrowUnsupported(
                                MarkerName(marker),
                                _offset,
                                $"JPEG frame type {MarkerName(marker)} is unsupported; only SOF0 is supported.");
                        }

                        ThrowMarker(
                            MarkerName(marker),
                            _offset,
                            $"Unexpected JPEG marker {MarkerName(marker)}.");
                        break;
                }
            }
        }

        private byte NextMarker()
        {
            if ((uint)_offset >= (uint)_data.Length)
            {
                ThrowTruncated("EOI", _offset);
            }

            if (_data[_offset] != 0xFF)
            {
                ThrowMarker(
                    "marker",
                    _offset,
                    "Expected a JPEG marker prefix (0xFF) but found raw data.");
            }

            while ((uint)_offset < (uint)_data.Length && _data[_offset] == 0xFF)
            {
                _offset++;
            }

            if ((uint)_offset >= (uint)_data.Length)
            {
                ThrowTruncated("marker", _offset);
            }

            byte marker = _data[_offset];
            _offset++;
            if (marker == 0x00)
            {
                ThrowMarker("0x00", _offset, "Stuffed zero byte appeared outside an entropy-coded scan.");
            }

            if (marker is >= 0xD0 and <= 0xD7)
            {
                ThrowMarker(
                    MarkerName(marker),
                    _offset,
                    "Restart marker appeared outside an entropy-coded scan.");
            }

            if (marker == MarkerSoi)
            {
                ThrowMarker("SOI", _offset, "JPEG SOI marker appeared more than once.");
            }

            return marker;
        }

        private ReadOnlySpan<byte> ReadSegment(byte marker)
        {
            if ((uint)(_offset + 2) > (uint)_data.Length)
            {
                ThrowTruncated(MarkerName(marker), _offset);
            }

            int length = (_data[_offset] << 8) | _data[_offset + 1];
            if (length < 2 || (uint)(_offset + length) > (uint)_data.Length)
            {
                ThrowTruncated(MarkerName(marker), _offset);
            }

            ReadOnlySpan<byte> segment = _data.Slice(_offset + 2, length - 2);
            _offset += length;
            return segment;
        }

        private void ParseFrame(ReadOnlySpan<byte> segment)
        {
            if (_frameSeen)
            {
                ThrowMarker("SOF0", _offset, "JPEG frame header is duplicated.");
            }

            if (segment.Length < 6)
            {
                ThrowTruncated("SOF0", _offset);
            }

            int precision = segment[0];
            int height = (segment[1] << 8) | segment[2];
            int width = (segment[3] << 8) | segment[4];
            int components = segment[5];

            if (precision != 8)
            {
                ThrowUnsupported(
                    "SOF0",
                    _offset,
                    $"JPEG sample precision {precision} is unsupported; only 8-bit baseline is supported.");
            }

            if (width <= 0 || height <= 0)
            {
                ThrowMarker(
                    "SOF0",
                    _offset,
                    "JPEG frame dimensions must be positive; DNL-defined heights are unsupported.");
            }

            if (width > MaxDimension || height > MaxDimension || (long)width * height > MaxPixels)
            {
                ThrowLimit("JPEG dimensions exceed the decoder budget.", _offset);
            }

            if (components is not (1 or 3))
            {
                ThrowUnsupported(
                    "SOF0",
                    _offset,
                    $"JPEG component count {components} is unsupported; only grayscale (1) and YCbCr (3) are supported.");
            }

            if (segment.Length < 6 + (components * 3))
            {
                ThrowTruncated("SOF0", _offset);
            }

            _width = width;
            _height = height;
            _componentCount = components;
            _maxH = 1;
            _maxV = 1;

            for (int i = 0; i < components; i++)
            {
                int componentOffset = 6 + (i * 3);
                byte id = segment[componentOffset];
                byte sampling = segment[componentOffset + 1];
                byte quantTable = segment[componentOffset + 2];
                int horizontal = sampling >> 4;
                int vertical = sampling & 0x0F;
                if (horizontal is < 1 or > 4 || vertical is < 1 or > 4)
                {
                    ThrowMarker(
                        "SOF0",
                        _offset,
                        $"JPEG component {id} has an unsupported sampling factor {horizontal}x{vertical}.");
                }

                if (quantTable > 3)
                {
                    ThrowMarker(
                        "SOF0",
                        _offset,
                        $"JPEG component {id} references quantization table {quantTable} outside 0..3.");
                }

                for (int duplicate = 0; duplicate < i; duplicate++)
                {
                    if (_componentId[duplicate] == id)
                    {
                        ThrowMarker("SOF0", _offset, $"JPEG component id {id} is duplicated.");
                    }
                }

                _componentId[i] = id;
                _componentH[i] = (byte)horizontal;
                _componentV[i] = (byte)vertical;
                _componentQuant[i] = quantTable;
                _maxH = Math.Max(_maxH, horizontal);
                _maxV = Math.Max(_maxV, vertical);
            }

            _frameSeen = true;
        }

        private void ParseQuantTables(ReadOnlySpan<byte> segment)
        {
            int position = 0;
            while (position < segment.Length)
            {
                int descriptor = segment[position++];
                int precision = descriptor >> 4;
                int table = descriptor & 0x0F;
                if (precision > 1 || table > 3)
                {
                    ThrowMarker("DQT", _offset, "JPEG quantization table descriptor is invalid.");
                }

                int valueBytes = precision == 0 ? 1 : 2;
                if (segment.Length - position < 64 * valueBytes)
                {
                    ThrowTruncated("DQT", _offset);
                }

                Span<int> values = _quant.Slice(table * 64, 64);
                for (int k = 0; k < 64; k++)
                {
                    int value = precision == 0
                        ? segment[position]
                        : (segment[position] << 8) | segment[position + 1];
                    position += valueBytes;
                    if (value == 0)
                    {
                        ThrowMarker("DQT", _offset, "JPEG quantization table contains a zero step.");
                    }

                    values[ZigZag[k]] = value;
                }

                _quantPresent[table] = 1;
            }
        }

        private void ParseHuffmanTables(ReadOnlySpan<byte> segment)
        {
            int position = 0;
            while (position < segment.Length)
            {
                if (segment.Length - position < 17)
                {
                    ThrowTruncated("DHT", _offset);
                }

                int descriptor = segment[position++];
                int tableClass = descriptor >> 4;
                int table = descriptor & 0x0F;
                if (tableClass > 1 || table > 3)
                {
                    ThrowMarker("DHT", _offset, "JPEG Huffman table descriptor is invalid.");
                }

                int total = 0;
                Span<byte> counts = _huffmanCounts.Slice(((tableClass * 4) + table) * 16, 16);
                for (int i = 0; i < 16; i++)
                {
                    counts[i] = segment[position + i];
                    total += segment[position + i];
                }

                position += 16;
                if (total == 0 || total > 256 || segment.Length - position < total)
                {
                    ThrowMarker("DHT", _offset, "JPEG Huffman table symbol count is invalid.");
                }

                ReadOnlySpan<byte> symbols = segment.Slice(position, total);
                position += total;
                BuildHuffmanTable((tableClass * 4) + table, counts, symbols, total);
            }
        }

        private void BuildHuffmanTable(int slot, ReadOnlySpan<byte> counts, ReadOnlySpan<byte> symbols, int total)
        {
            symbols.CopyTo(_huffmanSymbols.Slice(slot * 256, total));
            Span<int> minimum = _huffmanMinCode.Slice(slot * 17, 17);
            Span<int> maximum = _huffmanMaxCode.Slice(slot * 17, 17);
            Span<int> valuePointer = _huffmanValuePointer.Slice(slot * 17, 17);
            minimum.Clear();
            maximum.Clear();
            valuePointer.Clear();

            int code = 0;
            int symbolIndex = 0;
            for (int length = 1; length <= 16; length++)
            {
                int count = counts[length - 1];
                if (count == 0)
                {
                    maximum[length] = -1;
                    continue;
                }

                minimum[length] = code;
                valuePointer[length] = symbolIndex;
                code += count;
                if (code > 1 << length)
                {
                    ThrowMarker("DHT", _offset, "JPEG Huffman table is oversubscribed.");
                }

                maximum[length] = code - 1;
                symbolIndex += count;
                code <<= 1;
            }

            _huffmanPresent[slot] = 1;
        }

        private void ParseRestartInterval(ReadOnlySpan<byte> segment)
        {
            if (segment.Length != 2)
            {
                ThrowMarker("DRI", _offset, "JPEG DRI segment must contain exactly one interval.");
            }

            _restartInterval = (segment[0] << 8) | segment[1];
        }

        private void ParseScan(ReadOnlySpan<byte> segment)
        {
            if (segment.Length < 1)
            {
                ThrowTruncated("SOS", _offset);
            }

            int count = segment[0];
            if (count is < 1 or > 4 || segment.Length < 1 + (count * 2) + 3)
            {
                ThrowMarker("SOS", _offset, "JPEG scan header is malformed.");
            }

            if (count != _componentCount)
            {
                ThrowUnsupported(
                    "SOS",
                    _offset,
                    "Non-interleaved baseline scans are unsupported; the scan must cover every frame component.");
            }

            for (int i = 0; i < count; i++)
            {
                int componentId = segment[1 + (i * 2)];
                int tables = segment[2 + (i * 2)];
                int dcTable = tables >> 4;
                int acTable = tables & 0x0F;
                if (dcTable > 3 || acTable > 3)
                {
                    ThrowMarker("SOS", _offset, "JPEG scan component references a Huffman table outside 0..3.");
                }

                int frameComponent = -1;
                for (int c = 0; c < _componentCount; c++)
                {
                    if (_componentId[c] == componentId)
                    {
                        frameComponent = c;
                        break;
                    }
                }

                if (frameComponent < 0)
                {
                    ThrowMarker("SOS", _offset, $"JPEG scan references unknown component id {componentId}.");
                }

                for (int previous = 0; previous < i; previous++)
                {
                    if (_scanComponent[previous] == frameComponent)
                    {
                        ThrowMarker("SOS", _offset, $"JPEG scan component id {componentId} is duplicated.");
                    }
                }

                if (_huffmanPresent[dcTable] == 0 || _huffmanPresent[4 + acTable] == 0)
                {
                    ThrowMarker(
                        "SOS",
                        _offset,
                        $"JPEG component {componentId} references a Huffman table that was not defined.");
                }

                _scanComponent[i] = (byte)frameComponent;
                _scanDcTable[i] = (byte)dcTable;
                _scanAcTable[i] = (byte)acTable;
            }

            int spectralStart = segment[1 + (count * 2)];
            int spectralEnd = segment[2 + (count * 2)];
            int approximation = segment[3 + (count * 2)];
            if (spectralStart != 0 || spectralEnd != 63 || approximation != 0)
            {
                ThrowUnsupported(
                    "SOS",
                    _offset,
                    "Progressive or non-baseline spectral selection is unsupported; baseline requires Ss=0, Se=63, Ah=Al=0.");
            }

            _scanComponentCount = count;
            _scanSeen = true;
        }

        private void DecodeScan(
            Span<byte> destination,
            int stride,
            bool allocateOutput,
            GltfJpegChromaUpsampling upsampling,
            out byte[]? allocated)
        {
            allocated = null;
            int width = _width;
            int height = _height;

            if (allocateOutput)
            {
                int length = checked(width * height * 4);
                byte[] output = GC.AllocateUninitializedArray<byte>(length, pinned: true);
                destination = output;
                stride = width * 4;
                allocated = output;
            }
            else
            {
                if (stride < width * 4 ||
                    (long)(height - 1) * stride + (width * 4) > destination.Length)
                {
                    ThrowLimit("JPEG destination span is smaller than the decoded RGBA8 image.", _offset);
                }
            }

            _mcuCols = (width + (_maxH * 8) - 1) / (_maxH * 8);
            _mcuRows = (height + (_maxV * 8) - 1) / (_maxV * 8);

            byte[]? plane0 = null;
            byte[]? plane1 = null;
            byte[]? plane2 = null;
            try
            {
                for (int component = 0; component < _componentCount && _componentCount > 1; component++)
                {
                    _planeWidth[component] =
                        ((width * _componentH[component]) + _maxH - 1) / _maxH;
                    _planeHeight[component] =
                        ((height * _componentV[component]) + _maxV - 1) / _maxV;
                    _planeStride[component] = _mcuCols * _componentH[component] * 8;
                    int rows = _mcuRows * _componentV[component] * 8;
                    int size = checked(_planeStride[component] * rows);
                    byte[] plane = ArrayPool<byte>.Shared.Rent(size);
                    switch (component)
                    {
                        case 0:
                            plane0 = plane;
                            break;
                        case 1:
                            plane1 = plane;
                            break;
                        default:
                            plane2 = plane;
                            break;
                    }
                }

                var reader = new BitReader(_data, _offset);
                int totalMcus = _mcuCols * _mcuRows;
                int mcu = 0;
                int restartIndex = 0;

                for (int mcuRow = 0; mcuRow < _mcuRows; mcuRow++)
                {
                    for (int mcuCol = 0; mcuCol < _mcuCols; mcuCol++)
                    {
                        for (int scanIndex = 0; scanIndex < _scanComponentCount; scanIndex++)
                        {
                            int component = _scanComponent[scanIndex];
                            byte dcTable = _scanDcTable[scanIndex];
                            byte acTable = _scanAcTable[scanIndex];
                            bool directGray = _componentCount == 1;
                            byte[]? plane = directGray
                                ? null
                                : component switch
                                {
                                    0 => plane0!,
                                    1 => plane1!,
                                    _ => plane2!,
                                };

                            int horizontal = _componentH[component];
                            int vertical = _componentV[component];
                            for (int blockRow = 0; blockRow < vertical; blockRow++)
                            {
                                for (int blockColumn = 0; blockColumn < horizontal; blockColumn++)
                                {
                                    DecodeBlock(ref reader, component, dcTable, acTable);
                                    int blockX = ((mcuCol * horizontal) + blockColumn) * 8;
                                    int blockY = ((mcuRow * vertical) + blockRow) * 8;
                                    TransformBlock(component, _samples);
                                    if (directGray)
                                    {
                                        CopyBlockToDestination(destination, stride, blockX, blockY);
                                    }
                                    else
                                    {
                                        CopyBlockToPlane(plane!, _planeStride[component], blockX, blockY);
                                    }
                                }
                            }
                        }

                        mcu++;
                        if (_restartInterval > 0 && mcu < totalMcus && mcu % _restartInterval == 0)
                        {
                            reader.ExpectRestart(restartIndex);
                            restartIndex++;
                            _dcPredictor.Clear();
                        }
                    }
                }

                _offset = reader.EndOfScanPosition();
                if (_componentCount > 1)
                {
                    Compose(destination, stride, upsampling, plane0!, plane1, plane2);
                }
            }
            finally
            {
                if (plane0 is not null)
                {
                    ArrayPool<byte>.Shared.Return(plane0);
                }

                if (plane1 is not null)
                {
                    ArrayPool<byte>.Shared.Return(plane1);
                }

                if (plane2 is not null)
                {
                    ArrayPool<byte>.Shared.Return(plane2);
                }
            }
        }

        private void DecodeBlock(ref BitReader reader, int component, byte dcTable, byte acTable)
        {
            _coefficients.Clear();
            int category = DecodeHuffman(ref reader, dcTable);
            if (category > 11)
            {
                ThrowScan("SOS", _offset, "JPEG DC coefficient category exceeds 11.");
            }

            int difference = category == 0 ? 0 : Extend(reader.ReadBits(category), category);
            int predictor = _dcPredictor[component] + difference;
            if (predictor is < -16384 or > 16384)
            {
                ThrowScan("SOS", _offset, "JPEG DC predictor left the supported coefficient range.");
            }

            _dcPredictor[component] = predictor;
            _coefficients[0] = predictor;

            int zigzagIndex = 1;
            while (zigzagIndex < 64)
            {
                int symbol = DecodeHuffman(ref reader, 4 + acTable);
                int run = symbol >> 4;
                int size = symbol & 0x0F;
                if (size == 0)
                {
                    if (run == 15)
                    {
                        zigzagIndex += 16;
                        continue;
                    }

                    break;
                }

                zigzagIndex += run;
                if (zigzagIndex > 63)
                {
                    ThrowScan("SOS", _offset, "JPEG AC run exceeds the coefficient block.");
                }

                if (size > 10)
                {
                    ThrowScan("SOS", _offset, "JPEG AC coefficient category exceeds 10.");
                }

                _coefficients[ZigZag[zigzagIndex]] = Extend(reader.ReadBits(size), size);
                zigzagIndex++;
            }
        }

        private int DecodeHuffman(ref BitReader reader, int slot)
        {
            int code = 0;
            for (int length = 1; length <= 16; length++)
            {
                code = (code << 1) | reader.ReadBit();
                int maximum = _huffmanMaxCode[(slot * 17) + length];
                if (maximum >= 0 && code <= maximum)
                {
                    int index = _huffmanValuePointer[(slot * 17) + length]
                        + code
                        - _huffmanMinCode[(slot * 17) + length];
                    if ((uint)index >= 256u)
                    {
                        ThrowScan("SOS", _offset, "JPEG Huffman symbol index is out of range.");
                    }

                    return _huffmanSymbols[(slot * 256) + index];
                }
            }

            ThrowScan("SOS", _offset, "JPEG Huffman code was not found in the table.");
            return 0;
        }

        private static int Extend(int value, int size)
        {
            int threshold = 1 << (size - 1);
            return value < threshold ? value - ((1 << size) - 1) : value;
        }

        private void TransformBlock(int component, Span<byte> samples)
        {
            Span<int> quant = _quant.Slice(_componentQuant[component] * 64, 64);
            int dc = _coefficients[0] * quant[0];
            bool acZero = true;
            for (int index = 1; index < 64; index++)
            {
                if (_coefficients[index] != 0)
                {
                    acZero = false;
                    break;
                }
            }

            if (acZero)
            {
                samples.Fill(RoundSample(dc / 8.0));
                return;
            }

            Span<double> temporary = _idctTemporary;
            for (int u = 0; u < 8; u++)
            {
                for (int yPosition = 0; yPosition < 8; yPosition++)
                {
                    double sum = 0.0;
                    for (int v = 0; v < 8; v++)
                    {
                        int coefficient = _coefficients[(v * 8) + u];
                        if (coefficient != 0)
                        {
                            sum += coefficient * quant[(v * 8) + u] * IdctCosine[(v * 8) + yPosition];
                        }
                    }

                    temporary[(u * 8) + yPosition] = sum;
                }
            }

            for (int yPosition = 0; yPosition < 8; yPosition++)
            {
                for (int xPosition = 0; xPosition < 8; xPosition++)
                {
                    double sum = 0.0;
                    for (int u = 0; u < 8; u++)
                    {
                        sum += temporary[(u * 8) + yPosition] * IdctCosine[(u * 8) + xPosition];
                    }

                    samples[(yPosition * 8) + xPosition] = RoundSample(sum * 0.25);
                }
            }
        }

        private void CopyBlockToPlane(byte[] plane, int stride, int blockX, int blockY)
        {
            for (int row = 0; row < 8; row++)
            {
                _samples.Slice(row * 8, 8).CopyTo(plane.AsSpan(((blockY + row) * stride) + blockX, 8));
            }
        }

        private void CopyBlockToDestination(Span<byte> destination, int stride, int blockX, int blockY)
        {
            int columns = Math.Min(8, _width - blockX);
            if (columns <= 0)
            {
                return;
            }

            for (int row = 0; row < 8; row++)
            {
                int y = blockY + row;
                if (y >= _height)
                {
                    break;
                }

                int target = (y * stride) + (blockX * 4);
                for (int column = 0; column < columns; column++)
                {
                    byte sample = _samples[(row * 8) + column];
                    int pixel = target + (column * 4);
                    destination[pixel] = sample;
                    destination[pixel + 1] = sample;
                    destination[pixel + 2] = sample;
                    destination[pixel + 3] = 255;
                }
            }
        }

        private static byte RoundSample(double value)
        {
            double rounded = Math.Floor(value + 128.5);
            return rounded <= 0.0 ? (byte)0 : rounded >= 255.0 ? (byte)255 : (byte)(int)rounded;
        }

        private void Compose(
            Span<byte> destination,
            int stride,
            GltfJpegChromaUpsampling upsampling,
            byte[] plane0,
            byte[]? plane1,
            byte[]? plane2)
        {
            for (int y = 0; y < _height; y++)
            {
                int rowStart = y * stride;
                for (int x = 0; x < _width; x++)
                {
                    int luminance = SamplePlane(plane0, 0, x, y, upsampling);
                    byte red;
                    byte green;
                    byte blue;
                    if (_componentCount == 1)
                    {
                        red = (byte)luminance;
                        green = (byte)luminance;
                        blue = (byte)luminance;
                    }
                    else
                    {
                        int cb = SamplePlane(plane1!, 1, x, y, upsampling) - 128;
                        int cr = SamplePlane(plane2!, 2, x, y, upsampling) - 128;
                        red = ClampByte(luminance + ((LumaRed * cr) >> 16));
                        green = ClampByte(
                            luminance - (((LumaGreenCb * cb) + (LumaGreenCr * cr)) >> 16));
                        blue = ClampByte(luminance + ((LumaBlue * cb) >> 16));
                    }

                    int target = rowStart + (x * 4);
                    destination[target] = red;
                    destination[target + 1] = green;
                    destination[target + 2] = blue;
                    destination[target + 3] = 255;
                }
            }
        }

        private int SamplePlane(
            byte[] plane,
            int component,
            int x,
            int y,
            GltfJpegChromaUpsampling upsampling)
        {
            int horizontal = _componentH[component];
            int vertical = _componentV[component];
            int planeWidth = _planeWidth[component];
            int planeHeight = _planeHeight[component];
            int planeStride = _planeStride[component];

            if (upsampling == GltfJpegChromaUpsampling.Nearest)
            {
                int sourceX = (x * horizontal) / _maxH;
                int sourceY = (y * vertical) / _maxV;
                if (sourceX >= planeWidth)
                {
                    sourceX = planeWidth - 1;
                }

                if (sourceY >= planeHeight)
                {
                    sourceY = planeHeight - 1;
                }

                return plane[(sourceY * planeStride) + sourceX];
            }

            long sourceXFixed = ((((2L * x) + 1) * horizontal * 32768) / (2 * _maxH)) - 16384;
            long sourceYFixed = ((((2L * y) + 1) * vertical * 32768) / (2 * _maxV)) - 16384;
            int maxXFixed = (planeWidth - 1) << 15;
            int maxYFixed = (planeHeight - 1) << 15;
            if (sourceXFixed < 0)
            {
                sourceXFixed = 0;
            }
            else if (sourceXFixed > maxXFixed)
            {
                sourceXFixed = maxXFixed;
            }

            if (sourceYFixed < 0)
            {
                sourceYFixed = 0;
            }
            else if (sourceYFixed > maxYFixed)
            {
                sourceYFixed = maxYFixed;
            }

            int x0 = (int)(sourceXFixed >> 15);
            int y0 = (int)(sourceYFixed >> 15);
            int fractionX = (int)(sourceXFixed >> 7) & 255;
            int fractionY = (int)(sourceYFixed >> 7) & 255;
            int x1 = x0 + 1 < planeWidth ? x0 + 1 : x0;
            int y1 = y0 + 1 < planeHeight ? y0 + 1 : y0;

            int topLeft = plane[(y0 * planeStride) + x0];
            int topRight = plane[(y0 * planeStride) + x1];
            int bottomLeft = plane[(y1 * planeStride) + x0];
            int bottomRight = plane[(y1 * planeStride) + x1];
            int inverseX = 256 - fractionX;
            int inverseY = 256 - fractionY;
            int weighted = (topLeft * inverseX * inverseY)
                + (topRight * fractionX * inverseY)
                + (bottomLeft * inverseX * fractionY)
                + (bottomRight * fractionX * fractionY);
            return (weighted + 32768) >> 16;
        }

        private static byte ClampByte(int value) =>
            value < 0 ? (byte)0 : value > 255 ? (byte)255 : (byte)value;
    }
}
