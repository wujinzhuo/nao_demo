import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';
import { AuthForm, FormTextField } from '@/components/auth-form';

export function ModifyPassword() {
	const { refetch } = useSession();
	const [serverError, setServerError] = useState<string | undefined>();

	const modifyUserPassword = useMutation(
		trpc.account.modifyPassword.mutationOptions({
			onSuccess: async () => {
				await refetch();
			},
			onError: (err) => setServerError(err.message),
		}),
	);

	const form = useForm({
		defaultValues: { newPassword: '', confirmPassword: '' },
		onSubmit: async ({ value }) => {
			if (value.newPassword !== value.confirmPassword) {
				setServerError('两次输入的密码不一致');
				return;
			}
			setServerError(undefined);
			await modifyUserPassword.mutateAsync({
				newPassword: value.newPassword,
				confirmPassword: value.confirmPassword,
			});
		},
	});

	return (
		<div className='flex h-screen'>
			<AuthForm
				form={form}
				title='修改密码以保护你的账号'
				submitText={modifyUserPassword.isPending ? '更新中…' : '重置密码'}
				serverError={serverError}
			>
				<FormTextField form={form} name='newPassword' type='password' title='新密码' className='mb-6' />
				<FormTextField
					form={form}
					name='confirmPassword'
					type='password'
					title='确认新密码'
					className='mb-10'
				/>
			</AuthForm>
		</div>
	);
}
