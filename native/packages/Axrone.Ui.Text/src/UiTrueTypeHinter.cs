namespace Axrone.Ui.Text;

internal sealed class UiTrueTypeHintData
{
    public UiTrueTypeHintData(int fpgmOffset, int fpgmLength, int prepOffset, int prepLength, int cvtOffset, int cvtCount)
    {
        FpgmOffset = fpgmOffset;
        FpgmLength = fpgmLength;
        PrepOffset = prepOffset;
        PrepLength = prepLength;
        CvtOffset = cvtOffset;
        CvtCount = cvtCount;
    }

    public int FpgmOffset { get; }

    public int FpgmLength { get; }

    public int PrepOffset { get; }

    public int PrepLength { get; }

    public int CvtOffset { get; }

    public int CvtCount { get; }
}

internal sealed class UiTrueTypeHinter
{
    private const int StageFpgm = 0;
    private const int StagePrep = 1;
    private const int StageGlyph = 2;
    private const int PhantomCount = 4;
    private const int MaxTwilight = 64;
    private const int MaxStorage = 1024;
    private const int MaxFunctions = 256;
    private const int MaxFrames = 64;
    private const int MaxIfDepth = 32;
    private const int MaxStackDepth = 4096;
    private const int MaxSteps = 500_000;

    private const int RoundOff = 0;
    private const int RoundGrid = 1;
    private const int RoundHalfGrid = 2;
    private const int RoundDoubleGrid = 3;
    private const int RoundDownToGrid = 4;
    private const int RoundUpToGrid = 5;
    private const int RoundSuper = 6;

    private readonly int[] _stack = new int[MaxStackDepth];
    private readonly int[] _cvt = new int[MaxStorage];
    private readonly int[] _storage = new int[MaxStorage];
    private readonly int[] _functionStage = new int[MaxFunctions];
    private readonly int[] _functionOffset = new int[MaxFunctions];
    private readonly bool[] _functionDefined = new bool[MaxFunctions];
    private readonly int[] _idefStage = new int[MaxFunctions];
    private readonly int[] _idefOffset = new int[MaxFunctions];
    private readonly bool[] _idefDefined = new bool[MaxFunctions];
    private readonly int[] _frameStage = new int[MaxFrames];
    private readonly int[] _frameOffset = new int[MaxFrames];
    private readonly int[] _frameFunctionStage = new int[MaxFrames];
    private readonly int[] _frameFunctionOffset = new int[MaxFrames];
    private readonly int[] _frameRepeat = new int[MaxFrames];
    private readonly byte[] _ifStack = new byte[MaxIfDepth];
    private readonly int[] _twilightX = new int[MaxTwilight];
    private readonly int[] _twilightY = new int[MaxTwilight];
    private int[] _x = new int[32];
    private int[] _y = new int[32];
    private int[] _originalX = new int[32];
    private int[] _originalY = new int[32];
    private bool[] _onCurve = new bool[32];
    private bool[] _touchedX = new bool[32];
    private bool[] _touchedY = new bool[32];
    private int[] _contourEnds = new int[8];

    private UiFontFace? _preparedFace;
    private float _preparedSize = -1.0f;
    private float _scale;
    private int _ppem;
    private int _cvtCount;
    private int _pointCount;
    private int _contourCount;
    private int _stackDepth;
    private int _ifDepth;
    private int _skipDepth;
    private bool _skipElseAllowed;
    private bool _fault;
    private bool _stackFault;
    private int _steps;
    private GraphicsState _gs;
    private GraphicsState _prepState;

    public bool TryHintGlyph(
        UiFontFace face,
        float pixelSize,
        ReadOnlySpan<byte> instructions,
        Span<float> pointX,
        Span<float> pointY,
        ReadOnlySpan<bool> onCurve,
        ReadOnlySpan<int> contourEnds,
        int pointCount,
        int advance,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (instructions.IsEmpty || pointCount <= 0)
        {
            return true;
        }

        if (!Prepare(face, pixelSize, out error))
        {
            return false;
        }

        EnsurePointCapacity(pointCount + PhantomCount);
        EnsureContourCapacity(contourEnds.Length);
        float factor = _scale * 64.0f;
        for (int i = 0; i < pointCount; i++)
        {
            _x[i] = ToFixed(pointX[i] * factor);
            _y[i] = ToFixed(pointY[i] * factor);
            _originalX[i] = _x[i];
            _originalY[i] = _y[i];
            _onCurve[i] = onCurve[i];
            _touchedX[i] = false;
            _touchedY[i] = false;
        }

        for (int i = 0; i < PhantomCount; i++)
        {
            int index = pointCount + i;
            _x[index] = 0;
            _y[index] = 0;
            _originalX[index] = 0;
            _originalY[index] = 0;
            _onCurve[index] = true;
            _touchedX[index] = false;
            _touchedY[index] = false;
        }

        _x[pointCount + 1] = ToFixed(advance * factor);
        _originalX[pointCount + 1] = _x[pointCount + 1];
        _pointCount = pointCount + PhantomCount;
        contourEnds.CopyTo(_contourEnds);
        _contourCount = contourEnds.Length;
        _gs = _prepState;
        _stackDepth = 0;
        _ifDepth = 0;
        _skipDepth = 0;
        _skipElseAllowed = false;
        _fault = false;
        _stackFault = false;

        ReadOnlySpan<byte> fpgm = GetProgram(face, face.HintData, StageFpgm);
        ReadOnlySpan<byte> prep = GetProgram(face, face.HintData, StagePrep);
        if (!Execute(fpgm, prep, instructions, StageGlyph, out error))
        {
            return false;
        }

        if (factor == 0.0f)
        {
            return true;
        }

        for (int i = 0; i < pointCount; i++)
        {
            pointX[i] = _x[i] / factor;
            pointY[i] = _y[i] / factor;
        }

        return true;
    }

    private bool Prepare(UiFontFace face, float pixelSize, out UiFontError error)
    {
        error = UiFontError.None;
        if (ReferenceEquals(_preparedFace, face) && MathF.Abs(_preparedSize - pixelSize) < 1e-4f)
        {
            return true;
        }

        _preparedFace = null;
        _preparedSize = pixelSize;
        _scale = pixelSize / face.UnitsPerEm;
        _ppem = Math.Max(1, (int)MathF.Round(pixelSize));
        _stackDepth = 0;
        _ifDepth = 0;
        _skipDepth = 0;
        _skipElseAllowed = false;
        _fault = false;
        _stackFault = false;
        Array.Clear(_storage);
        Array.Clear(_functionDefined);
        Array.Clear(_idefDefined);
        Array.Clear(_twilightX);
        Array.Clear(_twilightY);
        _gs = GraphicsState.Default;
        _pointCount = 0;
        _contourCount = 0;
        _cvtCount = 0;

        UiTrueTypeHintData? hintData = face.HintData;
        if (hintData is not null)
        {
            _cvtCount = Math.Min(hintData.CvtCount, _cvt.Length);
            ReadOnlySpan<byte> buffer = face.Buffer.Span;
            float factor = _scale * 64.0f;
            for (int i = 0; i < _cvtCount; i++)
            {
                _cvt[i] = ToFixed(UiFontFace.ReadI16(buffer, hintData.CvtOffset + (i * 2)) * factor);
            }
        }

        ReadOnlySpan<byte> fpgm = hintData is null
            ? ReadOnlySpan<byte>.Empty
            : face.Buffer.Span.Slice(hintData.FpgmOffset, hintData.FpgmLength);
        ReadOnlySpan<byte> prep = hintData is null
            ? ReadOnlySpan<byte>.Empty
            : face.Buffer.Span.Slice(hintData.PrepOffset, hintData.PrepLength);
        ReadOnlySpan<byte> glyph = ReadOnlySpan<byte>.Empty;
        if (!Execute(fpgm, prep, glyph, StageFpgm, out error))
        {
            return false;
        }

        _stackDepth = 0;
        _ifDepth = 0;
        _skipDepth = 0;
        _fault = false;
        _stackFault = false;
        if (!Execute(fpgm, prep, glyph, StagePrep, out error))
        {
            return false;
        }

        _prepState = _gs;
        _preparedFace = face;
        return true;
    }

    private static ReadOnlySpan<byte> GetProgram(UiFontFace face, UiTrueTypeHintData? hintData, int stage)
    {
        if (hintData is null)
        {
            return ReadOnlySpan<byte>.Empty;
        }

        ReadOnlySpan<byte> buffer = face.Buffer.Span;
        return stage == StageFpgm
            ? buffer.Slice(hintData.FpgmOffset, hintData.FpgmLength)
            : buffer.Slice(hintData.PrepOffset, hintData.PrepLength);
    }

    private bool Execute(
        ReadOnlySpan<byte> fpgm,
        ReadOnlySpan<byte> prep,
        ReadOnlySpan<byte> glyph,
        int startStage,
        out UiFontError error)
    {
        error = UiFontError.None;
        int stage = startStage;
        int pc = 0;
        int frameDepth = 0;
        _steps = MaxSteps;
        while (true)
        {
            ReadOnlySpan<byte> program = ProgramFor(fpgm, prep, glyph, stage);
            if (_fault || _stackFault)
            {
                return Fault(out error, pc, "The glyph hint program is invalid.");
            }

            if (pc < 0 || pc >= program.Length)
            {
                if (stage != StageGlyph)
                {
                    return true;
                }

                if (frameDepth == 0)
                {
                    return true;
                }

                return Fault(out error, pc, "The hint function is not terminated.");
            }

            if (--_steps <= 0)
            {
                return Fault(out error, pc, "The hint program exceeded the step budget.");
            }

            byte op = program[pc++];
            if (_skipDepth > 0)
            {
                if (!SkipInstruction(program, ref pc, op, out bool endf))
                {
                    return Fault(out error, pc, "The conditional hint block is malformed.");
                }

                if (endf && frameDepth > 0)
                {
                    if (!EndFunction(frameDepth, out frameDepth, out stage, out pc))
                    {
                        return Fault(out error, pc, "The hint function is malformed.");
                    }
                }

                continue;
            }

            switch (op)
            {
                case 0x00:
                case 0x01:
                    SetAxisVectors((op & 1) != 0);
                    break;
                case 0x02:
                case 0x03:
                    SetProjectionAxis((op & 1) != 0);
                    break;
                case 0x04:
                case 0x05:
                    SetFreedomAxis((op & 1) != 0);
                    break;
                case 0x06:
                case 0x07:
                    SetProjectionToLine((op & 1) != 0);
                    break;
                case 0x08:
                case 0x09:
                    SetFreedomToLine((op & 1) != 0);
                    break;
                case 0x0A:
                    SetProjectionFromStack();
                    break;
                case 0x0B:
                    SetFreedomFromStack();
                    break;
                case 0x0C:
                    Push(ToFixed(_gs.ProjectionX));
                    Push(ToFixed(_gs.ProjectionY));
                    break;
                case 0x0D:
                    Push(ToFixed(_gs.FreedomX));
                    Push(ToFixed(_gs.FreedomY));
                    break;
                case 0x0E:
                    _gs.FreedomX = _gs.ProjectionX;
                    _gs.FreedomY = _gs.ProjectionY;
                    break;
                case 0x0F:
                    Intersect();
                    break;
                case 0x10:
                    _gs.Rp0 = Pop();
                    break;
                case 0x11:
                    _gs.Rp1 = Pop();
                    break;
                case 0x12:
                    _gs.Rp2 = Pop();
                    break;
                case 0x13:
                    _gs.Zp0 = Pop();
                    break;
                case 0x14:
                    _gs.Zp1 = Pop();
                    break;
                case 0x15:
                    _gs.Zp2 = Pop();
                    break;
                case 0x16:
                    _gs.Zp0 = _gs.Zp1 = _gs.Zp2 = Pop();
                    break;
                case 0x17:
                    _gs.Loop = Pop();
                    if (_gs.Loop <= 0)
                    {
                        _fault = true;
                    }

                    break;
                case 0x18:
                    _gs.RoundState = RoundGrid;
                    break;
                case 0x19:
                    _gs.RoundState = RoundHalfGrid;
                    break;
                case 0x1B:
                    BeginElse();
                    break;
                case 0x1C:
                    pc += Pop();
                    break;
                case 0x1D:
                    _gs.CvtCutIn = Pop();
                    break;
                case 0x1E:
                    _gs.SingleWidthCutIn = Pop();
                    break;
                case 0x1F:
                    _gs.SingleWidthValue = Pop();
                    break;
                case 0x20:
                    Push(Peek());
                    break;
                case 0x21:
                    _ = Pop();
                    break;
                case 0x22:
                    _stackDepth = 0;
                    break;
                case 0x23:
                    Swap();
                    break;
                case 0x24:
                    Push(_stackDepth);
                    break;
                case 0x25:
                    CopyIndex();
                    break;
                case 0x26:
                    MoveIndex();
                    break;
                case 0x27:
                    AlignPoints();
                    break;
                case 0x29:
                    Untouch();
                    break;
                case 0x2A:
                    LoopCall(ref frameDepth, ref stage, ref pc);
                    break;
                case 0x2B:
                    Call(ref frameDepth, ref stage, ref pc);
                    break;
                case 0x2C:
                    DefineFunction(false, program, stage, ref pc);
                    break;
                case 0x2D:
                    if (!EndFunction(frameDepth, out frameDepth, out stage, out pc))
                    {
                        _fault = true;
                    }

                    break;
                case 0x2E:
                    MoveDirectAbsolute(false);
                    break;
                case 0x2F:
                    MoveDirectAbsolute(true);
                    break;
                case 0x30:
                    InterpolateUntouched(false);
                    break;
                case 0x31:
                    InterpolateUntouched(true);
                    break;
                case 0x32:
                    ShiftPoints(false);
                    break;
                case 0x33:
                    ShiftPoints(true);
                    break;
                case 0x34:
                    ShiftContour(false);
                    break;
                case 0x35:
                    ShiftContour(true);
                    break;
                case 0x36:
                    ShiftZone(false);
                    break;
                case 0x37:
                    ShiftZone(true);
                    break;
                case 0x38:
                    ShiftPixels();
                    break;
                case 0x39:
                    InterpolatePoints();
                    break;
                case 0x3A:
                    MoveStackRelative(false);
                    break;
                case 0x3B:
                    MoveStackRelative(true);
                    break;
                case 0x3C:
                    AlignRelative();
                    break;
                case 0x3D:
                    _gs.RoundState = RoundDoubleGrid;
                    break;
                case 0x3E:
                    MoveIndirectAbsolute(false);
                    break;
                case 0x3F:
                    MoveIndirectAbsolute(true);
                    break;
                case 0x40:
                    PushBytes(program, ref pc, false);
                    break;
                case 0x41:
                    PushBytes(program, ref pc, true);
                    break;
                case 0x42:
                    WriteStorage();
                    break;
                case 0x43:
                    Push(ReadStorage());
                    break;
                case 0x44:
                    WriteCvt(false);
                    break;
                case 0x45:
                    Push(ReadCvt());
                    break;
                case 0x46:
                    GetCoordinate(false);
                    break;
                case 0x47:
                    GetCoordinate(true);
                    break;
                case 0x48:
                    SetCoordinateFromStack();
                    break;
                case 0x49:
                    MeasureDistance(false);
                    break;
                case 0x4A:
                    MeasureDistance(true);
                    break;
                case 0x4B:
                    Push(_ppem);
                    break;
                case 0x4C:
                    Push(ToFixed(_preparedSize * 64.0f));
                    break;
                case 0x4D:
                    _gs.AutoFlip = true;
                    break;
                case 0x4E:
                    _gs.AutoFlip = false;
                    break;
                case 0x4F:
                    _ = Pop();
                    break;
                case 0x50:
                    {
                        int top = Pop();
                        int below = Pop();
                        Push(below < top ? 1 : 0);
                        break;
                    }
                case 0x51:
                    {
                        int top = Pop();
                        int below = Pop();
                        Push(below <= top ? 1 : 0);
                        break;
                    }
                case 0x52:
                    {
                        int top = Pop();
                        int below = Pop();
                        Push(below > top ? 1 : 0);
                        break;
                    }
                case 0x53:
                    {
                        int top = Pop();
                        int below = Pop();
                        Push(below >= top ? 1 : 0);
                        break;
                    }
                case 0x54:
                    {
                        int top = Pop();
                        int below = Pop();
                        Push(below == top ? 1 : 0);
                        break;
                    }
                case 0x55:
                    {
                        int top = Pop();
                        int below = Pop();
                        Push(below != top ? 1 : 0);
                        break;
                    }
                case 0x56:
                    Push((Round(Pop()) >> 6) & 1);
                    break;
                case 0x57:
                    Push(((Round(Pop()) >> 6) & 1) == 0 ? 1 : 0);
                    break;
                case 0x58:
                    BeginIf();
                    break;
                case 0x59:
                    EndIf();
                    break;
                case 0x5A:
                    {
                        int first = Pop();
                        int second = Pop();
                        Push(first != 0 && second != 0 ? 1 : 0);
                        break;
                    }
                case 0x5B:
                    {
                        int first = Pop();
                        int second = Pop();
                        Push(first != 0 || second != 0 ? 1 : 0);
                        break;
                    }
                case 0x5C:
                    Push(Pop() == 0 ? 1 : 0);
                    break;
                case 0x5D:
                    ApplyDeltaPoints(0);
                    break;
                case 0x5E:
                    _gs.DeltaBase = Pop();
                    break;
                case 0x5F:
                    _gs.DeltaShift = Pop();
                    break;
                case 0x60:
                    {
                        int first = Pop();
                        int second = Pop();
                        Push(first + second);
                        break;
                    }
                case 0x61:
                    {
                        int top = Pop();
                        int below = Pop();
                        Push(below - top);
                        break;
                    }
                case 0x62:
                    {
                        int divisor = Pop();
                        int dividend = Pop();
                        Push(divisor == 0 ? 0 : (dividend * 64) / divisor);
                        break;
                    }
                case 0x63:
                    {
                        int first = Pop();
                        int second = Pop();
                        Push((first * second) / 64);
                        break;
                    }
                case 0x64:
                    Push(Math.Abs(Pop()));
                    break;
                case 0x65:
                    Push(-Pop());
                    break;
                case 0x66:
                    Push(Pop() & ~63);
                    break;
                case 0x67:
                    Push((Pop() + 63) & ~63);
                    break;
                case 0x68:
                case 0x69:
                case 0x6A:
                case 0x6B:
                    Push(Round(Pop()));
                    break;
                case 0x6C:
                case 0x6D:
                case 0x6E:
                case 0x6F:
                    Push(Pop());
                    break;
                case 0x70:
                    WriteCvt(true);
                    break;
                case 0x71:
                    ApplyDeltaPoints(1);
                    break;
                case 0x72:
                    ApplyDeltaPoints(2);
                    break;
                case 0x73:
                    ApplyDeltaCvt(0);
                    break;
                case 0x74:
                    ApplyDeltaCvt(1);
                    break;
                case 0x75:
                    ApplyDeltaCvt(2);
                    break;
                case 0x76:
                case 0x77:
                    _ = Pop();
                    _gs.RoundState = RoundSuper;
                    break;
                case 0x78:
                    JumpOnCondition(true, ref pc);
                    break;
                case 0x79:
                    JumpOnCondition(false, ref pc);
                    break;
                case 0x7A:
                    _gs.RoundState = RoundOff;
                    break;
                case 0x7C:
                    _gs.RoundState = RoundUpToGrid;
                    break;
                case 0x7D:
                    _gs.RoundState = RoundDownToGrid;
                    break;
                case 0x7E:
                    _ = Pop();
                    break;
                case 0x7F:
                    _ = Pop();
                    break;
                case 0x80:
                    FlipPoints();
                    break;
                case 0x81:
                    FlipRange(true);
                    break;
                case 0x82:
                    FlipRange(false);
                    break;
                case 0x86:
                case 0x87:
                    SetProjectionToLine((op & 1) != 0);
                    break;
                case 0x88:
                    Push(GetInfo());
                    break;
                case 0x89:
                    DefineFunction(true, program, stage, ref pc);
                    break;
                case 0x8A:
                    Roll();
                    break;
                case 0x8B:
                    {
                        int first = Pop();
                        int second = Pop();
                        Push(Math.Max(first, second));
                        break;
                    }
                case 0x8C:
                    {
                        int first = Pop();
                        int second = Pop();
                        Push(Math.Min(first, second));
                        break;
                    }
                case 0x8D:
                    _gs.ScanType = Pop();
                    break;
                case 0x8E:
                    {
                        int value = Pop();
                        int selector = Pop();
                        if (selector == 1)
                        {
                            _gs.InstructControl = value;
                        }
                        break;
                    }
                case 0x91:
                    break;
                case 0x85:
                    _gs.ScanControl = Pop();
                    break;
                case 0x92:
                case 0x93:
                    break;
                case 0xB0:
                case 0xB1:
                case 0xB2:
                case 0xB3:
                case 0xB4:
                case 0xB5:
                case 0xB6:
                case 0xB7:
                    {
                        int count = (op & 0x07) + 1;
                        for (int i = 0; i < count; i++)
                        {
                            if (pc >= program.Length)
                            {
                                _fault = true;
                                break;
                            }

                            Push(program[pc++]);
                        }
                        break;
                    }
                case 0xB8:
                case 0xB9:
                case 0xBA:
                case 0xBB:
                case 0xBC:
                case 0xBD:
                case 0xBE:
                case 0xBF:
                    {
                        int count = (op & 0x07) + 1;
                        for (int i = 0; i < count; i++)
                        {
                            if (pc + 2 > program.Length)
                            {
                                _fault = true;
                                break;
                            }

                            Push(UiFontFace.ReadI16(program, pc));
                            pc += 2;
                        }
                        break;
                    }
                default:
                    if (op >= 0xC0 && op <= 0xDF)
                    {
                        MoveDirectRelative(op);
                    }
                    else if (op >= 0xE0)
                    {
                        MoveIndirectRelative(op);
                    }
                    else if (_idefDefined[op])
                    {
                        CallDefined(op, ref frameDepth, ref stage, ref pc);
                    }
                    else
                    {
                        _fault = true;
                    }

                    break;
            }
        }
    }

    private bool SkipInstruction(ReadOnlySpan<byte> program, ref int pc, byte op, out bool endf)
    {
        endf = false;
        switch (op)
        {
            case 0x58:
                _skipDepth++;
                return true;
            case 0x1B:
                if (_skipDepth == 1 && _skipElseAllowed)
                {
                    _skipDepth = 0;
                    _skipElseAllowed = false;
                    _ifStack[_ifDepth - 1] = 1;
                }

                return true;
            case 0x59:
                _skipDepth--;
                if (_skipDepth == 0)
                {
                    _ifDepth--;
                }

                return true;
            case 0x2C:
            case 0x89:
                int end = FindEndf(program, pc);
                if (end < 0)
                {
                    return false;
                }

                pc = end;
                return true;
            case 0x40:
                if (pc >= program.Length)
                {
                    return false;
                }

                int bytes = program[pc++];
                if (pc + bytes > program.Length)
                {
                    return false;
                }

                pc += bytes;
                return true;
            case 0x41:
                if (pc >= program.Length)
                {
                    return false;
                }

                int words = program[pc++];
                if (pc + (words * 2) > program.Length)
                {
                    return false;
                }

                pc += words * 2;
                return true;
            case 0x2D:
                endf = true;
                return true;
            default:
                if (op is >= 0xB0 and <= 0xB7)
                {
                    pc += (op & 0x07) + 1;
                }
                else if (op is >= 0xB8 and <= 0xBF)
                {
                    pc += ((op & 0x07) + 1) * 2;
                }

                return pc <= program.Length;
        }
    }

    private static int FindEndf(ReadOnlySpan<byte> program, int pc)
    {
        while (pc < program.Length)
        {
            byte op = program[pc++];
            if (op == 0x2D)
            {
                return pc;
            }

            if (op == 0x40)
            {
                if (pc >= program.Length)
                {
                    return -1;
                }

                pc += program[pc] + 1;
            }
            else if (op == 0x41)
            {
                if (pc >= program.Length)
                {
                    return -1;
                }

                pc += (program[pc] * 2) + 1;
            }
            else if (op is >= 0xB0 and <= 0xB7)
            {
                pc += (op & 0x07) + 1;
            }
            else if (op is >= 0xB8 and <= 0xBF)
            {
                pc += ((op & 0x07) + 1) * 2;
            }
        }

        return -1;
    }

    private void DefineFunction(bool instruction, ReadOnlySpan<byte> program, int stage, ref int pc)
    {
        int id = Pop();
        if ((uint)id >= MaxFunctions || _fault)
        {
            _fault = true;
            return;
        }

        int end = FindEndf(program, pc);
        if (end < 0)
        {
            _fault = true;
            return;
        }

        if (instruction)
        {
            _idefDefined[id] = true;
            _idefStage[id] = stage;
            _idefOffset[id] = pc;
        }
        else
        {
            _functionDefined[id] = true;
            _functionStage[id] = stage;
            _functionOffset[id] = pc;
        }

        pc = end;
    }

    private void Call(ref int frameDepth, ref int stage, ref int pc)
    {
        int id = Pop();
        if (!_functionDefined[id] || frameDepth >= MaxFrames)
        {
            _fault = true;
            return;
        }

        PushFrame(frameDepth, stage, pc, _functionStage[id], _functionOffset[id], 1);
        frameDepth++;
        stage = _functionStage[id];
        pc = _functionOffset[id];
    }

    private void LoopCall(ref int frameDepth, ref int stage, ref int pc)
    {
        int id = Pop();
        int count = Pop();
        if (!_functionDefined[id] || frameDepth >= MaxFrames || count <= 0)
        {
            _fault = true;
            return;
        }

        PushFrame(frameDepth, stage, pc, _functionStage[id], _functionOffset[id], count);
        frameDepth++;
        stage = _functionStage[id];
        pc = _functionOffset[id];
    }

    private void CallDefined(byte id, ref int frameDepth, ref int stage, ref int pc)
    {
        if (frameDepth >= MaxFrames)
        {
            _fault = true;
            return;
        }

        PushFrame(frameDepth, stage, pc, _idefStage[id], _idefOffset[id], 1);
        frameDepth++;
        stage = _idefStage[id];
        pc = _idefOffset[id];
    }

    private void PushFrame(int depth, int stage, int pc, int functionStage, int functionOffset, int repeat)
    {
        _frameStage[depth] = stage;
        _frameOffset[depth] = pc;
        _frameFunctionStage[depth] = functionStage;
        _frameFunctionOffset[depth] = functionOffset;
        _frameRepeat[depth] = repeat;
    }

    private bool EndFunction(int frameDepth, out int newDepth, out int stage, out int pc)
    {
        newDepth = frameDepth;
        stage = StageGlyph;
        pc = 0;
        if (frameDepth <= 0)
        {
            return false;
        }

        int index = frameDepth - 1;
        newDepth = frameDepth;
        if (_frameRepeat[index] > 1)
        {
            _frameRepeat[index]--;
            stage = _frameFunctionStage[index];
            pc = _frameFunctionOffset[index];
            return true;
        }

        newDepth = index;
        stage = _frameStage[index];
        pc = _frameOffset[index];
        return true;
    }

    private void SetAxisVectors(bool xAxis)
    {
        _gs.ProjectionX = xAxis ? 1.0f : 0.0f;
        _gs.ProjectionY = xAxis ? 0.0f : 1.0f;
        _gs.FreedomX = _gs.ProjectionX;
        _gs.FreedomY = _gs.ProjectionY;
    }

    private void SetProjectionAxis(bool xAxis)
    {
        _gs.ProjectionX = xAxis ? 1.0f : 0.0f;
        _gs.ProjectionY = xAxis ? 0.0f : 1.0f;
    }

    private void SetFreedomAxis(bool xAxis)
    {
        _gs.FreedomX = xAxis ? 1.0f : 0.0f;
        _gs.FreedomY = xAxis ? 0.0f : 1.0f;
    }

    private void SetProjectionFromStack()
    {
        int x = Pop();
        int y = Pop();
        SetVector(ref _gs.ProjectionX, ref _gs.ProjectionY, x, y);
    }

    private void SetFreedomFromStack()
    {
        int x = Pop();
        int y = Pop();
        SetVector(ref _gs.FreedomX, ref _gs.FreedomY, x, y);
    }

    private void SetProjectionToLine(bool perpendicular)
    {
        int p1 = Pop();
        int p2 = Pop();
        GetPoint(1, p1, out int x1, out int y1);
        GetPoint(1, p2, out int x2, out int y2);
        float dx = x2 - x1;
        float dy = y2 - y1;
        if (perpendicular)
        {
            (dx, dy) = (-dy, dx);
        }

        SetVector(ref _gs.ProjectionX, ref _gs.ProjectionY, dx, dy);
    }

    private void SetFreedomToLine(bool perpendicular)
    {
        int p1 = Pop();
        int p2 = Pop();
        GetPoint(1, p1, out int x1, out int y1);
        GetPoint(1, p2, out int x2, out int y2);
        float dx = x2 - x1;
        float dy = y2 - y1;
        if (perpendicular)
        {
            (dx, dy) = (-dy, dx);
        }

        SetVector(ref _gs.FreedomX, ref _gs.FreedomY, dx, dy);
    }

    private static void SetVector(ref float x, ref float y, float rawX, float rawY)
    {
        float fx = rawX / 16384.0f;
        float fy = rawY / 16384.0f;
        float length = MathF.Sqrt((fx * fx) + (fy * fy));
        if (length <= 0.0001f)
        {
            x = 1.0f;
            y = 0.0f;
            return;
        }

        x = fx / length;
        y = fy / length;
    }

    private void BeginIf()
    {
        int condition = Pop();
        if (_ifDepth >= MaxIfDepth || _stackFault)
        {
            _fault = true;
            return;
        }

        _ifStack[_ifDepth++] = (byte)(condition != 0 ? 0 : 2);
        if (condition == 0)
        {
            _skipDepth = 1;
            _skipElseAllowed = true;
        }
    }

    private void BeginElse()
    {
        if (_ifDepth <= 0 || _ifStack[_ifDepth - 1] != 0)
        {
            _fault = true;
            return;
        }

        _ifStack[_ifDepth - 1] = 2;
        _skipDepth = 1;
        _skipElseAllowed = false;
    }

    private void EndIf()
    {
        if (_ifDepth <= 0)
        {
            _fault = true;
            return;
        }

        _ifDepth--;
    }

    private void JumpOnCondition(bool onTrue, ref int pc)
    {
        int offset = Pop();
        int condition = Pop();
        if ((condition != 0) == onTrue)
        {
            pc += offset;
        }
    }

    private void MoveDirectAbsolute(bool round)
    {
        int point = Pop();
        GetPoint(1, point, out int x, out int y);
        int current = ToFixed(Project(x, y));
        int target = round ? Round(current) : current;
        MoveAlongFreedom(1, point, target - current);
        _gs.Rp0 = point;
        _gs.Rp1 = point;
        Touch(1, point, true, true);
    }

    private void MoveIndirectAbsolute(bool round)
    {
        int point = Pop();
        int cvtIndex = Pop();
        if ((uint)cvtIndex >= (uint)_cvtCount)
        {
            _fault = true;
            return;
        }

        int distance = _cvt[cvtIndex];
        if (round)
        {
            distance = Round(distance);
        }

        if (_gs.Zp0 == 0)
        {
            _twilightX[point] = ToFixed(distance * _gs.ProjectionX);
            _twilightY[point] = ToFixed(distance * _gs.ProjectionY);
        }
        else
        {
            GetPoint(1, point, out int x, out int y);
            int current = ToFixed(Project(x, y));
            MoveAlongFreedom(1, point, distance - current);
        }

        _gs.Rp0 = point;
        _gs.Rp1 = point;
        Touch(_gs.Zp0 == 0 ? 0 : 1, point, true, true);
    }

    private void MoveDirectRelative(byte op)
    {
        int point = Pop();
        int zone = _gs.Zp1;
        GetPoint(zone, point, out int x, out int y);
        GetPoint(_gs.Zp0, _gs.Rp0, out int rx, out int ry);
        int distance = ToFixed(Project(x - rx, y - ry));
        int target = (op & 1) != 0 ? Round(distance) : distance;
        if ((op & 0x08) != 0 && Math.Abs(target) < _gs.MinDistance)
        {
            target = target < 0 ? -_gs.MinDistance : _gs.MinDistance;
        }

        MoveAlongFreedom(zone, point, target - distance);
        Touch(zone, point, true, true);
        _gs.Rp1 = _gs.Rp0;
        _gs.Rp2 = _gs.Rp0;
        if ((op & 0x10) != 0)
        {
            _gs.Rp0 = point;
        }
    }

    private void MoveIndirectRelative(byte op)
    {
        int point = Pop();
        int cvtIndex = Pop();
        if ((uint)cvtIndex >= (uint)_cvtCount ||
            (uint)point >= (uint)_pointCount ||
            (uint)_gs.Rp0 >= (uint)_pointCount)
        {
            _fault = true;
            return;
        }

        int zone = _gs.Zp1;
        GetPoint(zone, point, out int x, out int y);
        GetPoint(_gs.Zp0, _gs.Rp0, out int rx, out int ry);
        int originalDistance = ToFixed(Project(
            _originalX[point] - _originalX[_gs.Rp0],
            _originalY[point] - _originalY[_gs.Rp0]));
        int distance = _cvt[cvtIndex];
        if ((op & 1) != 0)
        {
            distance = Round(distance);
        }

        if (!_touchedX[point] && !_touchedY[point] && Math.Abs(distance - originalDistance) < _gs.CvtCutIn)
        {
            distance = originalDistance;
        }

        if ((op & 0x08) != 0 && Math.Abs(distance) < _gs.MinDistance)
        {
            distance = distance < 0 ? -_gs.MinDistance : _gs.MinDistance;
        }

        int current = ToFixed(Project(x - rx, y - ry));
        MoveAlongFreedom(zone, point, distance - current);
        Touch(zone, point, true, true);
        _gs.Rp1 = _gs.Rp0;
        _gs.Rp2 = _gs.Rp0;
        if ((op & 0x10) != 0)
        {
            _gs.Rp0 = point;
        }
    }

    private void MoveStackRelative(bool setReference)
    {
        int point = Pop();
        int distance = Pop();
        int zone = _gs.Zp1;
        GetPoint(zone, point, out int x, out int y);
        GetPoint(_gs.Zp0, _gs.Rp0, out int rx, out int ry);
        int current = ToFixed(Project(x - rx, y - ry));
        MoveAlongFreedom(zone, point, distance - current);
        Touch(zone, point, true, true);
        _gs.Rp1 = _gs.Rp0;
        _gs.Rp2 = _gs.Rp0;
        if (setReference)
        {
            _gs.Rp0 = point;
        }
    }

    private void AlignRelative()
    {
        int count = BeginLoop();
        for (int i = 0; i < count; i++)
        {
            int point = Pop();
            GetPoint(1, point, out int x, out int y);
            GetPoint(_gs.Zp0, _gs.Rp0, out int rx, out int ry);
            int current = ToFixed(Project(x, y));
            int target = ToFixed(Project(rx, ry));
            MoveAlongFreedom(1, point, target - current);
            Touch(1, point, true, true);
        }
    }

    private void AlignPoints()
    {
        int p1 = Pop();
        int p2 = Pop();
        GetPoint(1, p1, out int x1, out int y1);
        GetPoint(1, p2, out int x2, out int y2);
        int midX = (x1 + x2) / 2;
        int midY = (y1 + y2) / 2;
        SetPoint(1, p1, midX, midY);
        SetPoint(1, p2, midX, midY);
        Touch(1, p1, true, true);
        Touch(1, p2, true, true);
    }

    private void InterpolatePoints()
    {
        int count = BeginLoop();
        if ((uint)_gs.Rp1 >= (uint)_pointCount || (uint)_gs.Rp2 >= (uint)_pointCount)
        {
            _fault = true;
            return;
        }

        GetPoint(_gs.Zp1, _gs.Rp1, out int ox1, out int oy1);
        GetPoint(_gs.Zp2, _gs.Rp2, out int ox2, out int oy2);
        int rx1 = _originalX[_gs.Rp1];
        int ry1 = _originalY[_gs.Rp1];
        int rx2 = _originalX[_gs.Rp2];
        int ry2 = _originalY[_gs.Rp2];
        for (int i = 0; i < count; i++)
        {
            int point = Pop();
            if ((uint)point >= (uint)_pointCount)
            {
                _fault = true;
                return;
            }

            int originalX = _originalX[point];
            int originalY = _originalY[point];
            _x[point] = Interpolate(originalX, rx1, rx2, ox1, ox2);
            _y[point] = Interpolate(originalY, ry1, ry2, oy1, oy2);
            Touch(1, point, true, true);
        }
    }

    private static int Interpolate(int value, int originalStart, int originalEnd, int newStart, int newEnd)
    {
        if (originalEnd == originalStart)
        {
            return newStart;
        }

        int low = Math.Min(originalStart, originalEnd);
        int high = Math.Max(originalStart, originalEnd);
        if (value <= low)
        {
            return newStart + (value - originalStart);
        }

        if (value >= high)
        {
            return newEnd + (value - originalEnd);
        }

        return newStart + (int)(((long)(value - originalStart) * (newEnd - newStart)) / (originalEnd - originalStart));
    }

    private void ShiftPoints(bool useRp1)
    {
        int reference = useRp1 ? _gs.Rp1 : _gs.Rp2;
        int zone = useRp1 ? _gs.Zp1 : _gs.Zp2;
        if ((uint)reference >= (uint)_pointCount)
        {
            _fault = true;
            return;
        }

        GetCurrent(reference, out int currentX, out int currentY);
        int deltaX = currentX - _originalX[reference];
        int deltaY = currentY - _originalY[reference];
        int count = BeginLoop();
        for (int i = 0; i < count; i++)
        {
            int point = Pop();
            Shift(zone, point, deltaX, deltaY);
        }
    }

    private void ShiftContour(bool useRp1)
    {
        int contour = Pop();
        int reference = useRp1 ? _gs.Rp1 : _gs.Rp2;
        int zone = useRp1 ? _gs.Zp1 : _gs.Zp2;
        if ((uint)reference >= (uint)_pointCount || _contourCount == 0)
        {
            _fault = true;
            return;
        }

        GetCurrent(reference, out int currentX, out int currentY);
        int deltaX = currentX - _originalX[reference];
        int deltaY = currentY - _originalY[reference];
        int index = contour <= 0 ? _contourCount - 1 : contour - 1;
        if ((uint)index >= (uint)_contourCount)
        {
            _fault = true;
            return;
        }

        int start = index == 0 ? 0 : _contourEnds[index - 1] + 1;
        int end = Math.Min(_contourEnds[index], _pointCount - 1);
        for (int i = start; i <= end; i++)
        {
            Shift(zone, i, deltaX, deltaY);
        }
    }

    private void ShiftZone(bool useRp1)
    {
        int zone = Pop();
        int reference = useRp1 ? _gs.Rp1 : _gs.Rp2;
        if ((uint)reference >= (uint)_pointCount)
        {
            _fault = true;
            return;
        }

        int zoneReference = useRp1 ? _gs.Zp1 : _gs.Zp2;
        GetPoint(zoneReference, reference, out int currentX, out int currentY);
        int deltaX = currentX - _originalX[reference];
        int deltaY = currentY - _originalY[reference];
        int count = zone == 0 ? MaxTwilight : _pointCount;
        for (int i = 0; i < count; i++)
        {
            Shift(zone, i, deltaX, deltaY);
        }
    }

    private void ShiftPixels()
    {
        int distance = Pop();
        int count = BeginLoop();
        for (int i = 0; i < count; i++)
        {
            int point = Pop();
            MoveAlongFreedom(1, point, distance);
            Touch(1, point, true, true);
        }
    }

    private void Untouch()
    {
        int point = Pop();
        if ((uint)point >= (uint)_pointCount)
        {
            _fault = true;
            return;
        }

        _touchedX[point] = false;
        _touchedY[point] = false;
    }

    private void InterpolateUntouched(bool xAxis)
    {
        if (_contourCount == 0)
        {
            return;
        }

        int start = 0;
        for (int contour = 0; contour < _contourCount; contour++)
        {
            int end = Math.Min(_contourEnds[contour], _pointCount - 1);
            if (end < start)
            {
                start = end + 1;
                continue;
            }

            int firstTouched = -1;
            int touchedCount = 0;
            for (int i = start; i <= end; i++)
            {
                bool touched = xAxis ? _touchedX[i] : _touchedY[i];
                if (touched)
                {
                    touchedCount++;
                    if (firstTouched < 0)
                    {
                        firstTouched = i;
                    }
                }
            }

            if (touchedCount == 0)
            {
                start = end + 1;
                continue;
            }

            if (touchedCount == 1)
            {
                int delta = xAxis ? _x[firstTouched] - _originalX[firstTouched] : _y[firstTouched] - _originalY[firstTouched];
                for (int i = start; i <= end; i++)
                {
                    if (i != firstTouched && !(xAxis ? _touchedX[i] : _touchedY[i]))
                    {
                        if (xAxis)
                        {
                            _x[i] += delta;
                        }
                        else
                        {
                            _y[i] += delta;
                        }
                    }
                }

                start = end + 1;
                continue;
            }

            int previous = firstTouched;
            int current = firstTouched;
            for (int step = 0; step < end - start + 1; step++)
            {
                current = current == end ? start : current + 1;
                bool isTouched = xAxis ? _touchedX[current] : _touchedY[current];
                if (!isTouched)
                {
                    continue;
                }

                InterpolateContourRun(previous, current, start, end, xAxis);
                previous = current;
            }

            start = end + 1;
        }
    }

    private void InterpolateContourRun(int from, int to, int start, int end, bool xAxis)
    {
        int originFrom = xAxis ? _originalX[from] : _originalY[from];
        int originTo = xAxis ? _originalX[to] : _originalY[to];
        int newFrom = xAxis ? _x[from] : _y[from];
        int newTo = xAxis ? _x[to] : _y[to];
        int index = from;
        int guard = 0;
        while (guard++ <= end - start + 1)
        {
            index = index == end ? start : index + 1;
            if (index == to)
            {
                return;
            }

            int origin = xAxis ? _originalX[index] : _originalY[index];
            int value = Interpolate(origin, originFrom, originTo, newFrom, newTo);
            if (xAxis)
            {
                _x[index] = value;
            }
            else
            {
                _y[index] = value;
            }
        }
    }

    private void FlipPoints()
    {
        int count = BeginLoop();
        for (int i = 0; i < count; i++)
        {
            int point = Pop();
            if ((uint)point >= (uint)_pointCount)
            {
                _fault = true;
                return;
            }

            _onCurve[point] = !_onCurve[point];
        }
    }

    private void FlipRange(bool on)
    {
        int high = Pop();
        int low = Pop();
        if (low < 0 || high >= _pointCount || low > high)
        {
            _fault = true;
            return;
        }

        for (int i = low; i <= high; i++)
        {
            _onCurve[i] = on;
        }
    }

    private void Intersect()
    {
        int point = Pop();
        int b0 = Pop();
        int b1 = Pop();
        int a0 = Pop();
        int a1 = Pop();
        GetCurrent(a0, out int ax0, out int ay0);
        GetCurrent(a1, out int ax1, out int ay1);
        GetCurrent(b0, out int bx0, out int by0);
        GetCurrent(b1, out int bx1, out int by1);
        float dax = ax1 - ax0;
        float day = ay1 - ay0;
        float dbx = bx1 - bx0;
        float dby = by1 - by0;
        float denominator = (dax * dby) - (day * dbx);
        if (MathF.Abs(denominator) < 0.0001f)
        {
            _fault = true;
            return;
        }

        float t = ((bx0 - ax0) * dby - (by0 - ay0) * dbx) / denominator;
        int x = (int)MathF.Round(ax0 + (t * dax));
        int y = (int)MathF.Round(ay0 + (t * day));
        SetPoint(1, point, x, y);
        Touch(1, point, true, true);
    }

    private int GetCoordinate(bool original)
    {
        int point = Pop();
        if ((uint)point >= (uint)_pointCount)
        {
            _fault = true;
            return 0;
        }

        int x = original ? _originalX[point] : _x[point];
        int y = original ? _originalY[point] : _y[point];
        return ToFixed(Project(x, y));
    }

    private void SetCoordinateFromStack()
    {
        int point = Pop();
        int value = Pop();
        if ((uint)point >= (uint)_pointCount)
        {
            _fault = true;
            return;
        }

        int current = ToFixed(Project(_x[point], _y[point]));
        MoveAlongFreedom(1, point, value - current);
        Touch(1, point, true, true);
    }

    private void MeasureDistance(bool original)
    {
        int p1 = Pop();
        int p2 = Pop();
        if ((uint)p1 >= (uint)_pointCount || (uint)p2 >= (uint)_pointCount)
        {
            _fault = true;
            return;
        }

        int x1 = original ? _originalX[p1] : _x[p1];
        int y1 = original ? _originalY[p1] : _y[p1];
        int x2 = original ? _originalX[p2] : _x[p2];
        int y2 = original ? _originalY[p2] : _y[p2];
        Push(ToFixed(Project(x2 - x1, y2 - y1)));
    }

    private void ApplyDeltaPoints(int rangeIndex)
    {
        int count = Pop();
        for (int i = 0; i < count; i++)
        {
            int point = Pop();
            int argument = Pop();
            int target = _gs.DeltaBase + (argument >> 4) + (rangeIndex * 16);
            if (target != _ppem || (uint)point >= (uint)_pointCount)
            {
                continue;
            }

            int step = (argument & 0x0F) - 8;
            int distance = (step * 64) / (1 << Math.Clamp(_gs.DeltaShift, 0, 16));
            MoveAlongFreedom(1, point, distance);
            Touch(1, point, true, true);
        }
    }

    private void ApplyDeltaCvt(int rangeIndex)
    {
        int count = Pop();
        for (int i = 0; i < count; i++)
        {
            int cvtIndex = Pop();
            int argument = Pop();
            int target = _gs.DeltaBase + (argument >> 4) + (rangeIndex * 16);
            if (target != _ppem || (uint)cvtIndex >= (uint)_cvtCount)
            {
                continue;
            }

            int step = (argument & 0x0F) - 8;
            _cvt[cvtIndex] += (step * 64) / (1 << Math.Clamp(_gs.DeltaShift, 0, 16));
        }
    }

    private void WriteStorage()
    {
        int location = Pop();
        int value = Pop();
        if ((uint)location >= MaxStorage)
        {
            _fault = true;
            return;
        }

        _storage[location] = value;
    }

    private int ReadStorage()
    {
        int location = Pop();
        if ((uint)location >= MaxStorage)
        {
            _fault = true;
            return 0;
        }

        return _storage[location];
    }

    private void WriteCvt(bool fontUnits)
    {
        int location = Pop();
        int value = Pop();
        if ((uint)location >= (uint)_cvtCount)
        {
            _fault = true;
            return;
        }

        _cvt[location] = fontUnits ? ToFixed(value * _scale * 64.0f) : value;
    }

    private int ReadCvt()
    {
        int location = Pop();
        if ((uint)location >= (uint)_cvtCount)
        {
            _fault = true;
            return 0;
        }

        return _cvt[location];
    }

    private void PushBytes(ReadOnlySpan<byte> program, ref int pc, bool words)
    {
        if (pc >= program.Length)
        {
            _fault = true;
            return;
        }

        int count = program[pc++];
        int size = words ? 2 : 1;
        if (pc + (count * size) > program.Length)
        {
            _fault = true;
            return;
        }

        for (int i = 0; i < count; i++)
        {
            Push(words ? UiFontFace.ReadI16(program, pc) : program[pc]);
            pc += size;
        }
    }

    private void Roll()
    {
        int c = Pop();
        int b = Pop();
        int a = Pop();
        Push(b);
        Push(a);
        Push(c);
    }

    private void CopyIndex()
    {
        int index = Pop();
        if (index <= 0 || index > _stackDepth)
        {
            _fault = true;
            return;
        }

        Push(_stack[_stackDepth - index]);
    }

    private void MoveIndex()
    {
        int index = Pop();
        if (index <= 0 || index > _stackDepth)
        {
            _fault = true;
            return;
        }

        int value = _stack[_stackDepth - index];
        for (int i = _stackDepth - index; i < _stackDepth - 1; i++)
        {
            _stack[i] = _stack[i + 1];
        }

        _stack[_stackDepth - 1] = value;
        _stackDepth--;
        Push(value);
    }

    private void Swap()
    {
        int first = Pop();
        int second = Pop();
        Push(first);
        Push(second);
    }

    private int GetInfo()
    {
        int selector = Pop();
        return (selector & 1) != 0 ? 35 : 0;
    }

    private int BeginLoop()
    {
        int count = _gs.Loop;
        _gs.Loop = 1;
        if (count <= 0)
        {
            _fault = true;
            return 0;
        }

        return count;
    }

    private int Round(int value)
    {
        if (_gs.RoundState == RoundHalfGrid)
        {
            int sign = value >= 0 ? 1 : -1;
            int magnitude = Math.Abs(value);
            return sign * (((magnitude / 64) * 64) + 32);
        }

        return _gs.RoundState switch
        {
            RoundOff => value,
            RoundDoubleGrid => RoundTo(value, 32),
            RoundDownToGrid => DownTo(value, 64),
            RoundUpToGrid => UpTo(value, 64),
            _ => RoundTo(value, 64),
        };
    }

    private static int RoundTo(int value, int unit)
    {
        int half = unit / 2;
        return value >= 0
            ? ((value + half) / unit) * unit
            : -(((-value) + half) / unit) * unit;
    }

    private static int DownTo(int value, int unit) =>
        value >= 0 ? (value / unit) * unit : -(((-value) + unit - 1) / unit) * unit;

    private static int UpTo(int value, int unit) =>
        value >= 0 ? ((value + unit - 1) / unit) * unit : -((-value) / unit) * unit;

    private float Project(int x, int y) => (x * _gs.ProjectionX) + (y * _gs.ProjectionY);

    private void MoveAlongFreedom(int zone, int point, int distance)
    {
        float denominator = (_gs.FreedomX * _gs.ProjectionX) + (_gs.FreedomY * _gs.ProjectionY);
        if (MathF.Abs(denominator) < 0.0001f)
        {
            return;
        }

        float amount = distance / denominator;
        int dx = ToFixed(amount * _gs.FreedomX);
        int dy = ToFixed(amount * _gs.FreedomY);
        GetPoint(zone, point, out int x, out int y);
        SetPoint(zone, point, x + dx, y + dy);
    }

    private void Shift(int zone, int point, int dx, int dy)
    {
        GetPoint(zone, point, out int x, out int y);
        SetPoint(zone, point, x + dx, y + dy);
        Touch(zone, point, true, true);
    }

    private void GetCurrent(int point, out int x, out int y)
    {
        if ((uint)point >= (uint)_pointCount)
        {
            _fault = true;
            x = 0;
            y = 0;
            return;
        }

        x = _x[point];
        y = _y[point];
    }

    private void GetPoint(int zone, int point, out int x, out int y)
    {
        if (zone == 0)
        {
            if ((uint)point >= MaxTwilight)
            {
                _fault = true;
                x = 0;
                y = 0;
                return;
            }

            x = _twilightX[point];
            y = _twilightY[point];
            return;
        }

        if ((uint)point >= (uint)_pointCount)
        {
            _fault = true;
            x = 0;
            y = 0;
            return;
        }

        x = _x[point];
        y = _y[point];
    }

    private void SetPoint(int zone, int point, int x, int y)
    {
        if (zone == 0)
        {
            if ((uint)point >= MaxTwilight)
            {
                _fault = true;
                return;
            }

            _twilightX[point] = x;
            _twilightY[point] = y;
            return;
        }

        if ((uint)point >= (uint)_pointCount)
        {
            _fault = true;
            return;
        }

        _x[point] = x;
        _y[point] = y;
    }

    private void Touch(int zone, int point, bool xAxis, bool yAxis)
    {
        if (zone != 1 || (uint)point >= (uint)_pointCount)
        {
            return;
        }

        if (xAxis)
        {
            _touchedX[point] = true;
        }

        if (yAxis)
        {
            _touchedY[point] = true;
        }
    }

    private void Push(int value)
    {
        if (_stackDepth >= MaxStackDepth)
        {
            _stackFault = true;
            return;
        }

        _stack[_stackDepth++] = value;
    }

    private int Pop()
    {
        if (_stackDepth <= 0)
        {
            _stackFault = true;
            return 0;
        }

        return _stack[--_stackDepth];
    }

    private int Peek()
    {
        if (_stackDepth <= 0)
        {
            _stackFault = true;
            return 0;
        }

        return _stack[_stackDepth - 1];
    }

    private static ReadOnlySpan<byte> ProgramFor(
        ReadOnlySpan<byte> fpgm,
        ReadOnlySpan<byte> prep,
        ReadOnlySpan<byte> glyph,
        int stage) => stage switch
        {
            StageFpgm => fpgm,
            StagePrep => prep,
            _ => glyph,
        };

    private void EnsurePointCapacity(int required)
    {
        if (_x.Length >= required)
        {
            return;
        }

        int capacity = Math.Max(required, _x.Length * 2);
        _x = new int[capacity];
        _y = new int[capacity];
        _originalX = new int[capacity];
        _originalY = new int[capacity];
        _onCurve = new bool[capacity];
        _touchedX = new bool[capacity];
        _touchedY = new bool[capacity];
    }

    private void EnsureContourCapacity(int required)
    {
        if (_contourEnds.Length >= required)
        {
            return;
        }

        _contourEnds = new int[Math.Max(required, _contourEnds.Length * 2)];
    }

    private static int ToFixed(float value) => (int)MathF.Round(value, MidpointRounding.AwayFromZero);

    private static bool Fault(out UiFontError error, int offset, string message)
    {
        error = UiFontError.At(UiFontErrorCode.InvalidHinting, offset, message);
        return false;
    }

    private struct GraphicsState
    {
        public float ProjectionX;
        public float ProjectionY;
        public float FreedomX;
        public float FreedomY;
        public int Rp0;
        public int Rp1;
        public int Rp2;
        public int Zp0;
        public int Zp1;
        public int Zp2;
        public int Loop;
        public int MinDistance;
        public int CvtCutIn;
        public int SingleWidthCutIn;
        public int SingleWidthValue;
        public int DeltaBase;
        public int DeltaShift;
        public int RoundState;
        public bool AutoFlip;
        public int ScanControl;
        public int ScanType;
        public int InstructControl;

        public static GraphicsState Default => new()
        {
            ProjectionX = 1.0f,
            ProjectionY = 0.0f,
            FreedomX = 1.0f,
            FreedomY = 0.0f,
            Zp0 = 1,
            Zp1 = 1,
            Zp2 = 1,
            Loop = 1,
            MinDistance = 64,
            CvtCutIn = 68,
            DeltaBase = 9,
            DeltaShift = 3,
            RoundState = RoundGrid,
            AutoFlip = true,
        };
    }
}
