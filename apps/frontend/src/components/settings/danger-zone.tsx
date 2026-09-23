import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

export function DangerZone() {
	const [isOpen, setIsOpen] = useState(false);
	const navigate = useNavigate();

	const deleteAllNonStarred = useMutation(
		trpc.chat.deleteAllNonStarred.mutationOptions({
			onSuccess: (_data, _, __, ctx) => {
				ctx.client.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
				setIsOpen(false);
				navigate({ to: '/' });
			},
		}),
	);

	return (
		<>
			<SettingsCard title='危险区域'>
				<div className='flex items-center justify-between gap-4'>
					<div className='space-y-0.5'>
						<p className='text-sm font-medium'>删除所有对话</p>
						<p className='text-xs text-muted-foreground'>
							永久删除所有未收藏的对话。已收藏的对话会保留。
						</p>
					</div>
					<Button variant='destructive' size='sm' onClick={() => setIsOpen(true)}>
						全部删除
					</Button>
				</div>
			</SettingsCard>

			<AlertDialog open={isOpen} onOpenChange={setIsOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>删除所有未收藏的对话？</AlertDialogTitle>
						<AlertDialogDescription>
							这将永久删除你所有未收藏的对话。此操作无法撤销。
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>取消</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							isLoading={deleteAllNonStarred.isPending}
							onClick={(e) => {
								e.preventDefault();
								deleteAllNonStarred.mutate();
							}}
						>
							全部删除
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
