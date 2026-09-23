import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { UserMemoryRecord } from '@nao/backend/memory';
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty } from '@/components/ui/empty';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SettingsMemoryItem, SettingsMemorySkeleton } from '@/components/settings/memory-item';
import { useMemoriesQuery, useMemoryMutations, useMemorySettingsQuery } from '@/queries/use-memories';
import { trpc } from '@/main';

export function SettingsMemories({ isAdmin }: { isAdmin: boolean }) {
	const projectMemorySettings = useQuery(trpc.project.getMemorySettings.queryOptions());
	const memorySettings = useMemorySettingsQuery();

	const { updateMemorySettingsMutation, updateMutation, deleteMutation } = useMemoryMutations();

	const projectMemoryEnabled = projectMemorySettings.data?.memoryEnabled ?? true;
	const userMemoryEnabled = memorySettings.data?.memoryEnabled ?? true;
	const isProjectDisabled = !projectMemoryEnabled;
	const isUserDisabled = !userMemoryEnabled;
	const canShowMemories = !isProjectDisabled && !isUserDisabled;

	const { data: memories, isLoading: isMemoriesLoading } = useMemoriesQuery(canShowMemories);

	const [editMemory, setEditMemory] = useState<UserMemoryRecord | null>(null);
	const [editContent, setEditContent] = useState('');
	const [deleteMemory, setDeleteMemory] = useState<UserMemoryRecord | null>(null);

	const isUserToggleDisabled = isProjectDisabled || updateMemorySettingsMutation.isPending;

	const memoryStatusMessage = useMemo(() => {
		if (isProjectDisabled) {
			return {
				toggle: isAdmin
					? '已对整个项目关闭。'
					: '管理员已为此项目关闭记忆功能。',
				empty: isAdmin
					? '在 代理 → 能力 中开启项目记忆，即可查看和使用已保存的记忆。'
					: '请联系管理员开启项目记忆，才能查看和使用已保存的记忆。',
			};
		}
		if (isUserDisabled) {
			return {
				toggle: '',
				empty: '为自己开启记忆功能，即可查看和使用已保存的记忆。',
			};
		}
		return null;
	}, [isAdmin, isProjectDisabled, isUserDisabled]);

	const handleUserToggle = (enabled: boolean) => {
		updateMemorySettingsMutation.mutate({ memoryEnabled: enabled });
	};

	const handleEditMemory = (memory: UserMemoryRecord) => {
		setEditMemory(memory);
		setEditContent(memory.content);
	};

	const handleDeleteMemory = (memory: UserMemoryRecord) => {
		setDeleteMemory(memory);
	};

	const handleSaveEdit = async () => {
		if (!editMemory) {
			return;
		}
		await updateMutation.mutateAsync({
			memoryId: editMemory.id,
			content: editContent,
		});
		setEditMemory(null);
	};

	const handleConfirmDelete = () => {
		if (!deleteMemory) {
			return;
		}
		deleteMutation.mutate({ memoryId: deleteMemory.id });
	};

	return (
		<SettingsCard
			title='你的记忆'
			description='nao 记住的关于你的信息。只有你可以查看和管理这些内容。'
			divide
		>
			<SettingsControlRow
				id='user-memory'
				label='为我开启记忆'
				description={
					isProjectDisabled ? memoryStatusMessage?.toggle : '允许 nao 保存和使用关于你的记忆。'
				}
				control={
					<Switch
						id='user-memory'
						checked={userMemoryEnabled}
						onCheckedChange={handleUserToggle}
						disabled={isUserToggleDisabled}
					/>
				}
			/>
			{memoryStatusMessage ? (
				<div className='space-y-1'>
					<Empty>{memoryStatusMessage.empty}</Empty>
				</div>
			) : isMemoriesLoading ? (
				<div className='flex flex-col divide-y'>
					<SettingsMemorySkeleton className='pt-0' />
					<SettingsMemorySkeleton />
					<SettingsMemorySkeleton className='pb-0' />
				</div>
			) : !memories?.length ? (
				<Empty>暂无已保存的记忆。</Empty>
			) : (
				<div className='flex flex-col divide-y'>
					{memories.map((memory) => (
						<SettingsMemoryItem
							key={memory.id}
							memory={memory}
							className='last:pb-0 first:pt-0'
							onEdit={handleEditMemory}
							onDelete={handleDeleteMemory}
						/>
					))}
				</div>
			)}

			<Dialog open={!!editMemory} onOpenChange={() => setEditMemory(null)}>
				<DialogContent className='p-6' showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>编辑记忆</DialogTitle>
					</DialogHeader>
					<div className='space-y-4'>
						<Textarea
							value={editContent}
							onChange={(event) => setEditContent(event.target.value)}
							rows={4}
						/>
						{updateMutation.error?.message && <ErrorMessage message={updateMutation.error.message} />}
					</div>
					<DialogFooter>
						<Button variant='ghost' onClick={() => setEditMemory(null)} disabled={updateMutation.isPending}>
							取消
						</Button>
						<Button
							onClick={handleSaveEdit}
							disabled={updateMutation.isPending || editContent.trim().length === 0}
						>
							保存
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog open={!!deleteMemory} onOpenChange={() => setDeleteMemory(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>删除这条记忆？</AlertDialogTitle>
						<AlertDialogDescription>
							这条记忆将被移除，代理将不再记得它。
						</AlertDialogDescription>
					</AlertDialogHeader>
					{deleteMutation.error?.message && <ErrorMessage message={deleteMutation.error.message} />}
					<AlertDialogFooter>
						<AlertDialogCancel variant='outline' size='sm' disabled={deleteMutation.isPending}>
							取消
						</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							size='sm'
							onClick={handleConfirmDelete}
							disabled={deleteMutation.isPending}
						>
							删除
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SettingsCard>
	);
}
