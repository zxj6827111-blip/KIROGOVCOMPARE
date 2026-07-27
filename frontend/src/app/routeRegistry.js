import {
  Activity,
  FileCheck2,
  FilePenLine,
  FolderKanban,
  GitCompare,
  ListTodo,
  Settings,
} from 'lucide-react';

export const NAV_GROUPS = {
  WORKBENCH: 'workbench',
  FILING: 'filing',
  REVIEW: 'review',
  COMPARISON: 'comparison',
  EXPORT: 'export',
  GOVINSIGHT: 'govinsight',
  ADMIN: 'admin',
};

export const NAV_GROUP_LABELS = {
  [NAV_GROUPS.WORKBENCH]: '年报工作台',
  [NAV_GROUPS.FILING]: '年报填报',
  [NAV_GROUPS.REVIEW]: '问题清单',
  [NAV_GROUPS.COMPARISON]: '比对中心',
  [NAV_GROUPS.EXPORT]: '任务中心',
  [NAV_GROUPS.GOVINSIGHT]: '智能治理',
  [NAV_GROUPS.ADMIN]: '系统管理',
};

export const routeRegistry = [
  {
    key: 'catalog',
    path: '/catalog',
    title: '年报工作台',
    navLabel: '年报工作台',
    navGroup: NAV_GROUPS.WORKBENCH,
    icon: FolderKanban,
    fallbackReturnTo: '/catalog',
    match: (pathname) => pathname === '/catalog' || pathname === '/catalog/reports',
  },
  {
    key: 'upload',
    path: '/upload',
    title: '上传报告',
    navGroup: NAV_GROUPS.WORKBENCH,
    fallbackReturnTo: '/catalog',
    match: (pathname) => pathname === '/upload',
  },
  {
    key: 'filing-editor',
    path: '/filing/:id',
    title: '填报编辑',
    navGroup: NAV_GROUPS.FILING,
    permission: 'file_reports',
    fallbackReturnTo: '/filing',
    match: (pathname) => /^\/filing\/\d+/.test(pathname),
  },
  {
    key: 'filing',
    path: '/filing',
    title: '年报填报',
    navLabel: '年报填报',
    navGroup: NAV_GROUPS.FILING,
    icon: FilePenLine,
    // 与后端一致：file_reports；system_admin / upload_reports 在登录 normalize 后会继承
    permission: 'file_reports',
    fallbackReturnTo: '/filing',
    match: (pathname) => pathname === '/filing' || pathname.startsWith('/filing/'),
  },
  {
    key: 'report-detail',
    path: '/catalog/reports/:id',
    title: '报告详情',
    navGroup: NAV_GROUPS.REVIEW,
    fallbackReturnTo: '/catalog',
    match: (pathname) => pathname.startsWith('/catalog/reports/'),
  },
  {
    key: 'issues',
    path: '/issues',
    title: '问题清单',
    navLabel: '问题清单',
    navGroup: NAV_GROUPS.REVIEW,
    icon: FileCheck2,
    fallbackReturnTo: '/catalog',
    match: (pathname) => pathname === '/issues' || pathname.startsWith('/issues/'),
  },
  {
    key: 'history',
    path: '/history',
    title: '比对中心',
    navLabel: '比对中心',
    navGroup: NAV_GROUPS.COMPARISON,
    icon: GitCompare,
    fallbackReturnTo: '/history',
    match: (pathname) => pathname === '/history',
  },
  {
    key: 'comparison-detail',
    path: '/comparison/:id',
    title: '比对详情',
    navGroup: NAV_GROUPS.COMPARISON,
    fallbackReturnTo: '/history',
    match: (pathname) => pathname.startsWith('/comparison/'),
  },
  {
    key: 'jobs',
    path: '/jobs',
    title: '任务中心',
    navLabel: '任务中心',
    navGroup: NAV_GROUPS.EXPORT,
    icon: ListTodo,
    fallbackReturnTo: '/jobs',
    match: (pathname) => pathname === '/jobs' || pathname === '/jobs/' || pathname.startsWith('/jobs/'),
  },
  {
    key: 'govinsight',
    path: '/govinsight',
    title: '智能治理',
    navLabel: '智能治理',
    navGroup: NAV_GROUPS.GOVINSIGHT,
    icon: Activity,
    fallbackReturnTo: '/govinsight',
    match: (pathname) => pathname === '/govinsight' || pathname.startsWith('/govinsight/'),
  },
  {
    key: 'system-admin',
    path: '/admin',
    title: '系统管理',
    navLabel: '系统管理',
    navGroup: NAV_GROUPS.ADMIN,
    icon: Settings,
    permissionsAny: ['manage_regions', 'manage_users'],
    fallbackReturnTo: '/catalog',
    match: (pathname) => pathname === '/admin',
  },
  {
    key: 'regions',
    path: '/regions',
    title: '城市管理',
    navGroup: NAV_GROUPS.ADMIN,
    permission: 'manage_regions',
    fallbackReturnTo: '/catalog',
    match: (pathname) => pathname === '/regions',
  },
  {
    key: 'users',
    path: '/admin/users',
    title: '用户管理',
    navGroup: NAV_GROUPS.ADMIN,
    permission: 'manage_users',
    fallbackReturnTo: '/catalog',
    match: (pathname) => pathname === '/admin/users',
  },
  {
    key: 'report-maintenance',
    path: '/report-maintenance',
    title: '年报维护',
    navGroup: NAV_GROUPS.REVIEW,
    fallbackReturnTo: '/catalog',
    match: (pathname) => pathname === '/report-maintenance',
  },
  {
    key: 'datacenter',
    path: '/datacenter',
    title: 'Data Center',
    navGroup: NAV_GROUPS.WORKBENCH,
    fallbackReturnTo: '/catalog',
    match: (pathname) => pathname === '/datacenter' || pathname.startsWith('/datacenter/'),
  },
];

export const primaryNavItems = [
  routeRegistry.find((route) => route.key === 'catalog'),
  routeRegistry.find((route) => route.key === 'filing'),
  routeRegistry.find((route) => route.key === 'issues'),
  routeRegistry.find((route) => route.key === 'history'),
  routeRegistry.find((route) => route.key === 'jobs'),
  routeRegistry.find((route) => route.key === 'govinsight'),
  routeRegistry.find((route) => route.key === 'system-admin'),
].filter(Boolean);

export function getRouteForPath(pathname) {
  return routeRegistry.find((route) => route.match(pathname)) || routeRegistry[0];
}

export function getNavGroupForPath(pathname) {
  return getRouteForPath(pathname)?.navGroup || NAV_GROUPS.WORKBENCH;
}

export function userCanAccessRoute(route, user) {
  if (route.permissionsAny?.length) {
    return route.permissionsAny.some((permission) => Boolean(user?.permissions?.[permission]));
  }
  if (!route?.permission) return true;
  // 年报填报：管理员/有上传权限的运营账号默认可见入口（后端仍校验 file_reports）
  if (route.permission === 'file_reports') {
    return Boolean(
      user?.permissions?.file_reports ||
        user?.permissions?.system_admin ||
        user?.permissions?.upload_reports
    );
  }
  return Boolean(user?.permissions?.[route.permission]);
}

export function getVisiblePrimaryNavItems(user) {
  return primaryNavItems.filter((route) => userCanAccessRoute(route, user));
}

export function getPrimaryNavTarget(route, user) {
  if (route?.key === 'system-admin' && !user?.permissions?.manage_regions && user?.permissions?.manage_users) {
    return '/admin?tab=users';
  }
  return route?.path || '/catalog';
}

export function appendReturnTo(path, returnTo) {
  if (!returnTo) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}returnTo=${encodeURIComponent(returnTo)}`;
}
