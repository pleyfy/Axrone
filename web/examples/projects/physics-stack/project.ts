const project = {
	id: 'physics-stack',
	name: 'Physics Stack',
	color: '#be123c',
	description: 'A stable box pyramid under gravity. Drag to orbit, click to drop another body into the stack.',
	entryFile: 'src/main.ts',
	order: 5,
	category: 'Physics',
	tags: ['Rigid bodies', 'Contacts', 'Gravity'],
	grid: true,
} as const;

export default project;
