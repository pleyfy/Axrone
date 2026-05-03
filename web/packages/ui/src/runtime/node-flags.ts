export const enum NodeFlag {
    Allocated = 1 << 0,
    Visible = 1 << 1,
    Interactive = 1 << 2,
    Enabled = 1 << 3,
    Focusable = 1 << 4,
    TextDirty = 1 << 5,
}
