export class PriorityQueueNode<TElement, TPriority> {
    constructor(
        public element: TElement,
        public priority: TPriority
    ) {}
}
