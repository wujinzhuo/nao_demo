import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { Fragment } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn, hideIf } from '@/lib/utils';

interface NavContext {
	isAdmin: boolean;
	isContextAdmin: boolean;
	isCloud: boolean;
	isViewer: boolean;
}

interface NavItem {
	label: string;
	to?: string;
	search?: { admin?: boolean };
	visible?: (ctx: NavContext) => boolean;
	exact?: boolean;
	badge?: string;
	badgeVariant?: 'new' | 'enterprise';
	leavesSettings?: boolean;
}

interface NavGroup {
	label: string;
	items: NavItem[];
}

const settingsNavGroups: NavGroup[] = [
	{
		label: '项目',
		items: [
			{
				label: '项目设置与预算',
				to: '/settings/project',
				visible: ({ isViewer }) => !isViewer,
				exact: true,
			},
			{
				label: '团队',
				to: '/settings/project/team',
				visible: ({ isViewer }) => !isViewer,
			},
			{
				label: '智能体',
				to: '/settings/project/agent',
				visible: ({ isViewer }) => !isViewer,
			},
			{
				label: '集成与 MCP',
				to: '/settings/project/integrations',
				visible: ({ isViewer }) => !isViewer,
			},
			{
				label: '外观',
				to: '/settings/appearance',
				visible: ({ isViewer }) => !isViewer,
			},
		],
	},
	{
		label: '上下文',
		items: [
			{
				label: 'Git',
				to: '/settings/git',
				visible: ({ isAdmin, isContextAdmin }) => isAdmin || isContextAdmin,
			},
			{
				label: '推荐',
				to: '/settings/recommendations',
				visible: ({ isAdmin, isContextAdmin }) => isAdmin || isContextAdmin,
				badge: 'Beta',
				badgeVariant: 'new',
			},
			{
				label: '文件浏览器',
				to: '/settings/context-explorer',
				visible: ({ isAdmin, isContextAdmin }) => isAdmin || isContextAdmin,
			},
		],
	},
	{
		label: '可观测性',
		items: [
			{
				label: '与 nao 数据对话',
				to: '/',
				search: { admin: true },
				visible: ({ isAdmin, isContextAdmin }) => isAdmin || isContextAdmin,
				exact: true,
				leavesSettings: true,
			},
			{
				label: '用量、成本与回放',
				to: '/settings/usage',
				visible: ({ isAdmin }) => isAdmin,
			},
			{
				label: '对话回放',
				to: '/settings/usage',
				visible: ({ isAdmin, isContextAdmin }) => !isAdmin && isContextAdmin,
			},
			{
				label: '服务器日志',
				to: '/settings/logs',
				visible: ({ isAdmin, isCloud }) => isAdmin && !isCloud,
			},
		],
	},
	{
		label: '组织',
		items: [
			{
				label: '组织设置',
				to: '/settings/organization',
				visible: ({ isViewer }) => !isViewer,
				exact: true,
			},
			{
				label: '成员',
				to: '/settings/organization/members',
				visible: ({ isViewer }) => !isViewer,
				exact: true,
			},
			{
				label: '存储',
				to: '/settings/storage',
				visible: ({ isViewer, isCloud }) => !isViewer && !isCloud,
			},
			{
				label: '企业版',
				to: '/settings/enterprise',
				visible: ({ isViewer, isCloud }) => !isViewer && !isCloud,
			},
		],
	},
];

const navRowClassName =
	'flex items-center gap-2 rounded-md transition-colors whitespace-nowrap px-2 py-[5px] text-[13px] leading-5';

interface SidebarSettingsNavProps {
	isCollapsed: boolean;
	isAdmin: boolean;
	isContextAdmin: boolean;
	isViewer: boolean;
	isCloud: boolean;
}

export function SidebarSettingsNav({
	isCollapsed,
	isAdmin,
	isContextAdmin,
	isViewer,
	isCloud,
}: SidebarSettingsNavProps) {
	const navContext = {
		isAdmin,
		isContextAdmin,
		isCloud,
		isViewer,
	};
	const navGroups = settingsNavGroups
		.map((group) => ({
			...group,
			items: group.items.filter((item) => item.visible?.(navContext) ?? true),
		}))
		.filter((group) => group.items.length > 0);

	return (
		<div className={cn('flex flex-1 min-h-0 flex-col gap-1 overflow-y-auto', hideIf(isCollapsed))}>
			<div className='flex-1 min-h-0 overflow-y-auto'>
				<nav className='flex flex-col px-2 gap-1'>
					{navGroups.map((group) => (
						<Fragment key={group.label}>
							<div className='px-2 pt-4 pb-0.5 text-[11px] leading-4 font-medium uppercase tracking-wide text-muted-foreground'>
								{group.label}
							</div>
							{group.items.map((item) => {
								const badge = item.badge ? (
									<Badge
										variant='ghost'
										className={cn(
											'ml-auto h-4 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide',
											item.badgeVariant === 'enterprise'
												? 'bg-primary/10 text-primary'
												: 'bg-secondary text-secondary-foreground',
										)}
									>
										{item.badge}
									</Badge>
								) : null;
								const leavesSettingsIndicator = item.leavesSettings ? (
									<>
										<ArrowUpRight
											aria-hidden='true'
											className={cn('size-3.5 text-muted-foreground', !badge && 'ml-auto')}
										/>
										<span className='sr-only'>在设置之外打开对话</span>
									</>
								) : null;

								return (
									<div key={`${item.to}-${item.label}`} className='flex flex-col'>
										{item.search ? (
											<Link
												to='/'
												search={item.search}
												activeOptions={item.exact ? { exact: true } : undefined}
												className={navRowClassName}
												activeProps={{
													className: cn('bg-sidebar-accent text-foreground font-medium'),
												}}
												inactiveProps={{
													className: cn('hover:bg-sidebar-accent hover:text-foreground'),
												}}
											>
												{item.label}
												{badge}
												{leavesSettingsIndicator}
											</Link>
										) : (
											<Link
												to={item.to}
												activeOptions={item.exact ? { exact: true } : undefined}
												className={navRowClassName}
												activeProps={{
													className: cn('bg-sidebar-accent text-foreground font-medium'),
												}}
												inactiveProps={{
													className: cn('hover:bg-sidebar-accent hover:text-foreground'),
												}}
											>
												{item.label}
												{badge}
												{leavesSettingsIndicator}
											</Link>
										)}
									</div>
								);
							})}
						</Fragment>
					))}
				</nav>
			</div>
		</div>
	);
}
