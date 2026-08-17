def pad_to_multiple(n: int, m: int = 8) -> int:
    n = int(n)
    r = n % m
    return n if r == 0 else n + (m - r)


def fit_long_side(w: int, h: int, max_side: int = 720) -> tuple[int, int]:
    w = max(1, int(w))
    h = max(1, int(h))
    long = max(w, h)
    if long <= max_side:
        return w, h
    scale = max_side / long
    return max(1, round(w * scale)), max(1, round(h * scale))
