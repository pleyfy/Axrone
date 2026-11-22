export const median = (values) => {
    const finite = [];
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            finite.push(value);
        }
    }
    if (finite.length === 0) {
        return null;
    }
    finite.sort((left, right) => left - right);
    const middle = finite.length >> 1;
    return finite.length % 2 === 1
        ? finite[middle]
        : (finite[middle - 1] + finite[middle]) / 2;
};
