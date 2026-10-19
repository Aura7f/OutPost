import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  Bug,
  ChevronsUpDown,
  Database,
  FileText,
  FolderKanban,
  Gauge,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Server,
  Settings,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { apiDocsUrl } from '@/lib/api';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Spinner,
} from '@/components/ui';

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Observe',
    items: [
      { label: 'Overview', to: '/overview', icon: LayoutDashboard },
      { label: 'Projects', to: '/projects', icon: FolderKanban },
      { label: 'Health checks', to: '/monitors', icon: Activity },
      { label: 'Errors', to: '/errors', icon: Bug },
      { label: 'Incidents', to: '/incidents', icon: AlertTriangle },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { label: 'Databases', to: '/databases', icon: Database },
      { label: 'Heartbeat', to: '/heartbeat', icon: HeartPulse },
      { label: 'Integrations', to: '/integrations', icon: Server },
    ],
  },
  {
    label: 'Operate',
    items: [
      { label: 'Reports', to: '/reports', icon: FileText },
      { label: 'Alerts', to: '/alerts', icon: Bell },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { label: 'Team', to: '/team', icon: Users },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

function Logo() {
  return (
    <Link to="/overview" className="flex items-center gap-2.5 px-2">
      <img src="/favicon.svg" alt="" className="size-7" />
      <span className="text-[13px] font-semibold tracking-[0.2em] text-foreground">OUTPOST</span>
    </Link>
  );
}

function TeamSwitcher() {
  const { activeTeam, teams, switchTeam } = useAuth();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md border border-border/80 bg-secondary/40 px-2.5 py-2 text-left transition-colors hover:bg-accent">
          <div className="flex size-6 items-center justify-center rounded bg-primary/10 text-2xs font-semibold text-primary">
            {activeTeam ? initials(activeTeam.name) : '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">{activeTeam?.name ?? 'Select team'}</p>
            <p className="truncate text-2xs text-muted-foreground">
              {activeTeam ? `${activeTeam.role.toLowerCase()} workspace` : 'No workspace'}
            </p>
          </div>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[220px]">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {teams.map((team) => (
          <DropdownMenuItem
            key={team.id}
            onSelect={() => {
              if (team.id !== activeTeam?.id) {
                switchTeam(team.id);
                toast.success(`Switched to ${team.name}`);
                navigate('/overview');
              }
            }}
          >
            <span className="flex size-5 items-center justify-center rounded bg-secondary text-[10px] font-semibold">
              {initials(team.name)}
            </span>
            <span className="flex-1 truncate">{team.name}</span>
            <span className="text-2xs text-muted-foreground">{team.role.toLowerCase()}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/onboarding?new=1')}>
          <Plus /> Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavSections({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  return (
    <nav className="space-y-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active =
                location.pathname === item.to ||
                (item.to !== '/overview' && location.pathname.startsWith(`${item.to}/`));
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={cn(
                    'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-colors',
                    active
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )}
                >
                  <item.icon
                    className={cn(
                      'size-3.5 transition-colors',
                      active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                  {active ? <span className="ml-auto h-3 w-0.5 rounded bg-primary/70" /> : null}
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function UserMenu() {
  const { user, signOut, activeTeam } = useAuth();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent">
          <Avatar className="size-7 rounded-md">
            {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback>{initials(user?.fullName, user?.email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">{user?.fullName || 'Account'}</p>
            <p className="truncate text-2xs text-muted-foreground">{user?.email}</p>
          </div>
          <ChevronsUpDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[220px]">
        <DropdownMenuLabel className="normal-case tracking-normal text-muted-foreground">
          {activeTeam?.name}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings /> Account settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.open(apiDocsUrl, '_blank', 'noopener,noreferrer')}>
          <BookOpen /> API reference
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut().then(() => navigate('/login'));
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarContents({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b border-border/60">
        <Logo />
      </div>
      <div className="p-3">
        <TeamSwitcher />
      </div>
      <div className="scrollbar-none flex-1 overflow-y-auto px-3 pb-4">
        <NavSections onNavigate={onNavigate} />
        <div className="mt-8 rounded-md border border-border/70 bg-card/40 p-3">
          <div className="flex items-center gap-1.5 text-2xs font-medium text-foreground">
            <ShieldCheck className="size-3.5 text-success" /> Tenant isolation active
          </div>
          <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
            Team access is re-checked on every API request.
          </p>
        </div>
      </div>
      <div className="border-t border-border/60 p-3">
        <UserMenu />
      </div>
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { activeTeam } = useAuth();
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] border-r border-border/70 bg-[#0f120f]/95 backdrop-blur lg:block">
        <SidebarContents />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="animate-in absolute inset-y-0 left-0 w-[260px] border-r border-border bg-[#0f120f] shadow-dialog">
            <button
              className="absolute right-2 top-3 z-10 rounded p-1 text-muted-foreground hover:text-foreground"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
            <SidebarContents onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[232px]">
        <header className="surface-radial sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-md md:px-6">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <Gauge className="hidden size-3.5 text-muted-foreground sm:block" />
            <span className="hidden text-xs text-muted-foreground sm:inline">Workspace</span>
            <span className="hidden text-xs text-muted-foreground/40 sm:inline">/</span>
            <span className="truncate text-xs font-medium text-foreground">{activeTeam?.name}</span>
            {activeTeam ? (
              <Badge variant={activeTeam.role === 'OWNER' ? 'success' : activeTeam.role === 'ADMIN' ? 'info' : 'muted'}>
                {activeTeam.role.toLowerCase()}
              </Badge>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <a
              href={apiDocsUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground sm:flex"
            >
              <BookOpen className="size-3.5" /> API docs
            </a>
            <Link to="/alerts">
              <Button variant="ghost" size="icon-sm" aria-label="Alerts">
                <Bell />
              </Button>
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1480px] px-4 py-6 md:px-7 md:py-7">
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-24 text-xs text-muted-foreground">
                <Spinner /> Loading page…
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
