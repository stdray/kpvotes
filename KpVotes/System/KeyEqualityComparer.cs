namespace KpVotes.System;

public record KeyEqualityComparer<T, TK>(Func<T, TK> GetKey) : IEqualityComparer<T>
{
    public bool Equals(T? x, T? y)
    {
        if (ReferenceEquals(x, y)) return true;
        if (x is null || y is null) return false;

        var keyX = GetKey(x);
        var keyY = GetKey(y);

        return EqualityComparer<TK>.Default.Equals(keyX, keyY);
    }

    public int GetHashCode(T obj)
    {
        if (obj is null) throw new ArgumentNullException(nameof(obj));

        var key = GetKey(obj);
        return key is null ? 0 : EqualityComparer<TK>.Default.GetHashCode(key);
    }
}