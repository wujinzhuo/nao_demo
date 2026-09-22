import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { signIn } from '@/lib/auth-client';
import { AuthForm, FormTextField } from '@/components/auth-form';
import { rememberSignInMethod } from '@/lib/last-sign-in-method';
import { getSafeRedirectPath } from '@/lib/safe-redirect';
import { trpc } from '@/main';

export const Route = createFileRoute('/login')({
	validateSearch: (search: Record<string, unknown>) => ({
		error: typeof search.error === 'string' ? search.error : undefined,
		redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
	}),
	component: Login,
});

function buildOAuthAuthorizeUrl() {
	const params = new URLSearchParams(window.location.search);
	if (!params.has('client_id')) {
		return null;
	}
	return `/api/auth/oauth2/authorize${window.location.search}`;
}

function Login() {
	const navigate = useNavigate();
	const router = useRouter();
	const { error: oauthError, redirect } = Route.useSearch();
	const [serverError, setServerError] = useState<string | undefined>(oauthError);
	const isSmtpSetup = useQuery(trpc.authConfig.smtp.isSetup.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const isUserLoginEnabled = config.data?.enableUserLogin;
	const isUserSignupEnabled = config.data?.enableUserSignup;

	const oauthAuthorizeUrl = buildOAuthAuthorizeUrl();
	const safeRedirect = getSafeRedirectPath(redirect);

	const form = useForm({
		defaultValues: { email: '', password: '' },
		onSubmit: async ({ value }) => {
			if (isUserLoginEnabled === false) {
				return;
			}
			setServerError(undefined);
			await signIn.email(value, {
				onSuccess: () => {
					rememberSignInMethod('email');
					if (oauthAuthorizeUrl) {
						window.location.href = oauthAuthorizeUrl;
					} else if (safeRedirect) {
						router.history.push(safeRedirect);
					} else {
						navigate({ to: '/' });
					}
				},
				onError: (err) => setServerError(err.error.message),
			});
		},
	});

	return (
		<AuthForm
			form={form}
			title='登录'
			submitText='登录'
			serverError={serverError}
			displaySocialProviders={true}
			socialCallbackUrl={oauthAuthorizeUrl ?? safeRedirect ?? undefined}
			displayEmailPasswordForm={isUserLoginEnabled}
			emailPasswordDisabledMessage='邮箱密码登录已禁用，请使用已配置的登录方式继续。'
			footer={
				isUserSignupEnabled ? (
					<>
						还没有账号？{' '}
						<Link
							to='/signup'
							search={{ error: undefined, redirect: safeRedirect ?? undefined }}
							className='text-violet underline underline-offset-2'
						>
							创建账号
						</Link>
					</>
				) : undefined
			}
		>
			<FormTextField
				form={form}
				name='email'
				type='email'
				title='邮箱'
				placeholder='joe@gmail.com'
				className='mb-4'
			/>
			<FormTextField
				form={form}
				name='password'
				type='password'
				title='密码'
				className={isUserLoginEnabled && isSmtpSetup.data ? 'mb-2' : 'mb-8'}
			/>
			{isUserLoginEnabled && isSmtpSetup.data && (
				<div className='text-right mb-6'>
					<Link
						to='/forgot-password'
						className='text-xs text-foreground font-medium underline underline-offset-2'
					>
						忘记密码
					</Link>
				</div>
			)}
		</AuthForm>
	);
}
