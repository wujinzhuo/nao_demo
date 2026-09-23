// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeedbackDialog } from './assistant-message-actions';

vi.mock('@/main', () => ({
	trpc: {},
}));

describe('FeedbackDialog', () => {
	afterEach(cleanup);

	it('shows positive feedback wording', () => {
		render(<FeedbackDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} isPending={false} vote='up' />);

		expect(screen.getByText('哪里做得好？')).toBeDefined();
		expect(screen.getByPlaceholderText('告诉我们哪里做得好（选填）')).toBeDefined();
	});

	it('preserves negative feedback wording', () => {
		render(<FeedbackDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} isPending={false} vote='down' />);

		expect(screen.getByText('哪里出了问题？')).toBeDefined();
		expect(screen.getByPlaceholderText('告诉我们哪里可以改进（选填）')).toBeDefined();
	});

	it('submits trimmed text or undefined when empty', () => {
		const onSubmit = vi.fn();
		render(<FeedbackDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} isPending={false} vote='up' />);

		fireEvent.change(screen.getByPlaceholderText('告诉我们哪里做得好（选填）'), {
			target: { value: '  Clear and useful  ' },
		});
		fireEvent.click(screen.getByRole('button', { name: '提交' }));
		fireEvent.click(screen.getByRole('button', { name: '提交' }));

		expect(onSubmit).toHaveBeenNthCalledWith(1, 'Clear and useful');
		expect(onSubmit).toHaveBeenNthCalledWith(2, undefined);
	});
});
