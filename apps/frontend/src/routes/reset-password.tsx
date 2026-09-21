import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { resetPassword } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';
import { useRedirectIfSmtpNotSetup } from '@/hooks/useRedirectIfSmtpNotSetup';

export const Route = createFileRoute('/reset-password')({
	validateSearch: (search: Record<string, unknown>) => ({
		token: typeof search.token === 'string' ? search.token : undefined,
		error: typeof search.error === 'string' ? search.error : undefined,
	}),
	component: ResetPassword,
});

function ResetPassword() {
	const isPending = useRedirectIfSmtpNotSetup();
	const navigate = useNavigate();
	const { token, error: tokenError } = Route.useSearch();
	const [serverError, setServerError] = useState<string | undefined>();

	const form = useForm({
		defaultValues: { newPassword: '', confirmPassword: '' },
		onSubmit: async ({ value }) => {
			if (value.newPassword !== value.confirmPassword) {
				setServerError('两次输入的密码不一致。');
				return;
			}
			setServerError(undefined);
			const { error } = await resetPassword({ newPassword: value.newPassword, token: token! });
			if (error) {
				setServerError(error.message);
			} else {
				navigate({ to: '/login', search: { error: undefined, redirect: undefined } });
			}
		},
	});

	if (isPending) {
		return null;
	}

	if (tokenError === 'INVALID_TOKEN' || !token) {
		return (
			<div className='mx-auto w-full max-w-md p-8 my-auto text-center'>
				<h1 className='text-2xl font-semibold mb-4'>链接无效或已过期</h1>
				<p className='text-muted-foreground mb-6'>
					此密码重置链接已失效，请重新申请一个。
				</p>
				<Link
					to='/forgot-password'
					className='text-xs text-foreground font-medium underline underline-offset-2'
				>
					重新申请链接
				</Link>
			</div>
		);
	}

	return (
		<AuthForm form={form} title='重置密码' submitText='设置新密码' serverError={serverError}>
			<FormTextField form={form} name='newPassword' type='password' title='新密码' className='mb-6' />
			<FormTextField
				form={form}
				name='confirmPassword'
				type='password'
				title='确认新密码'
				className='mb-10'
			/>
		</AuthForm>
	);
}
