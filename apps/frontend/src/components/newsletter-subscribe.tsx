import { useEffect, useId, useState } from 'react';

import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const NEWSLETTER_SUBSCRIBE_URL = 'https://licenses.getnao.io/newsletter/subscribe';

interface NewsletterSubscribeDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface NewsletterSubscribeInlineFormProps {
	initialEmail?: string;
}

interface NewsletterSubscribeFormProps {
	initialEmail?: string;
	variant?: 'dialog' | 'inline';
}

export function NewsletterSubscribeDialog({ open, onOpenChange }: NewsletterSubscribeDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>订阅 nao 资讯</DialogTitle>
					<DialogDescription>
						在收件箱获取产品更新、发布说明以及实用的分析代理技巧。
					</DialogDescription>
				</DialogHeader>
				<NewsletterSubscribeForm />
			</DialogContent>
		</Dialog>
	);
}

export function NewsletterSubscribeInlineForm({ initialEmail }: NewsletterSubscribeInlineFormProps) {
	return <NewsletterSubscribeForm initialEmail={initialEmail} variant='inline' />;
}

function NewsletterSubscribeForm({ initialEmail = '', variant = 'dialog' }: NewsletterSubscribeFormProps) {
	const inputId = useId();
	const isInline = variant === 'inline';
	const [email, setEmail] = useState(initialEmail);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [hasError, setHasError] = useState(false);

	useEffect(() => {
		setEmail(initialEmail);
	}, [initialEmail]);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setIsSubmitting(true);
		setMessage(null);
		setHasError(false);

		try {
			await subscribeToNewsletter(email);
			setMessage('订阅成功，感谢关注 nao。');
		} catch (error) {
			setHasError(true);
			setMessage(error instanceof Error ? error.message : '暂时无法订阅。');
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className={cn('flex flex-col gap-2', isInline && 'items-end gap-1')}>
			<form
				className={cn('flex gap-2', isInline ? 'items-center' : 'flex-col sm:flex-row')}
				onSubmit={handleSubmit}
			>
				<label htmlFor={inputId} className='sr-only'>
					邮箱地址
				</label>
				<Input
					id={inputId}
					type='email'
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					placeholder='you@example.com'
					required
					className={cn(isInline ? 'h-8 w-52' : 'sm:flex-1')}
					disabled={isSubmitting}
				/>
				<Button
					type='submit'
					variant={isInline ? 'secondary' : 'primary-gradient'}
					size={isInline ? 'sm' : 'default'}
					isLoading={isSubmitting}
				>
					订阅
				</Button>
			</form>
			{message && (
				<p
					className={cn('text-xs', hasError ? 'text-destructive' : 'text-muted-foreground')}
					role='status'
					aria-live='polite'
				>
					{message}
				</p>
			)}
		</div>
	);
}

async function subscribeToNewsletter(email: string) {
	const response = await fetch(NEWSLETTER_SUBSCRIBE_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: email.trim() }),
	});

	if (!response.ok) {
		throw new Error('现在无法订阅，请稍后再试。');
	}
}
