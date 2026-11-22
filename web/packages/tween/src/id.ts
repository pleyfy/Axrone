let _nextTweenId = 0;

export function nextTweenId(): number {
    return _nextTweenId++;
}
