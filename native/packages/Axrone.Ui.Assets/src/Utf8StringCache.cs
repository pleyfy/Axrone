namespace Axrone.Ui.Assets;

/// <summary>
/// Reuses a string instance while the incoming UTF-8 stays byte-identical, so
/// repeated reads of an unchanged document do not allocate.
/// </summary>
internal sealed class Utf8StringCache
{
    private string _value = string.Empty;
    private byte[] _bytes = new byte[64];
    private int _length;

    public string Get(ReadOnlySpan<byte> utf8)
    {
        if (_length == utf8.Length && _bytes.AsSpan(0, _length).SequenceEqual(utf8))
        {
            return _value;
        }

        _value = Encoding.UTF8.GetString(utf8);
        if (_bytes.Length < utf8.Length)
        {
            int capacity = _bytes.Length;
            while (capacity < utf8.Length)
            {
                capacity = capacity <= int.MaxValue / 2 ? capacity * 2 : utf8.Length;
            }

            _bytes = new byte[capacity];
        }

        utf8.CopyTo(_bytes);
        _length = utf8.Length;
        return _value;
    }
}
