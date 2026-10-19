import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  FolderKanban,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import type { Environment, ProjectListItem } from '@/lib/types';
import { useProjects } from '@/components/common';
import { useTeam } from '@/hooks/use-team';
import {
  CopyButton,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatCard,
  StatusBadge,
} from '@/components/common';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Textarea,
} from '@/components/ui';
import { dateTime, number } from '@/lib/format';

interface CreatedProject {
  id: string;
  name: string;
  environment: Environment;
  ingestionKey: string;
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canManage } = useTeam();
  const projects = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState<Environment>('PRODUCTION');

  useEffect(() => {
    if (searchParams.get('new') === '1') setCreateOpen(true);
  }, [searchParams]);

  const createProject = useMutation({
    mutationFn: () =>
      api<CreatedProject>('/projects', {
        method: 'POST',
        body: { name: name.trim(), description: description.trim() || undefined, environment },
      }),
    onSuccess: async (project) => {
      setCreateOpen(false);
      setCreated(project);
      setName('');
      setDescription('');
      setEnvironment('PRODUCTION');
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await queryClient.invalidateQueries({ queryKey: ['health-overview'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const list = projects.data ?? [];
  const healthy = list.filter((project) => project.health === 'UP').length;
  const openIncidents = list.reduce((total, project) => total + project.openIncidents, 0);
  const totalMonitors = list.reduce((total, project) => total + project._count.monitors, 0);

  return (
    <div>
      <PageHeader
        title="Projects"
        description="A project scopes monitors, integrations, error ingestion, and reports. Ingestion keys are shown once."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void projects.refetch()}
              disabled={projects.isFetching}
            >
              <RefreshCw className={projects.isFetching ? 'animate-spin' : ''} /> Refresh
            </Button>
            {canManage ? (
              <Button
                size="sm"
                onClick={() => {
                  setSearchParams({}, { replace: true });
                  setCreateOpen(true);
                }}
              >
                <Plus /> New project
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Projects" value={number(list.length)} icon={<FolderKanban className="size-4" />} />
        <StatCard
          label="Healthy projects"
          value={`${healthy}/${list.length}`}
          tone={healthy === list.length ? 'success' : 'warning'}
          hint="Based on active monitor status"
        />
        <StatCard
          label="Open incidents"
          value={number(openIncidents)}
          tone={openIncidents > 0 ? 'critical' : 'success'}
        />
        <StatCard label="Monitors" value={number(totalMonitors)} hint="Across all projects" />
      </div>

      <div className="mt-5">
        {projects.isLoading ? (
          <LoadingBlock rows={4} />
        ) : projects.error ? (
          <ErrorBlock error={projects.error} onRetry={() => void projects.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<FolderKanban className="size-4" />}
            title="Create your first project"
            description="Each project gets its own ingestion key, alert rules, integrations, and reports."
            action={
              canManage ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus /> Create project
                </Button>
              ) : (
                <p className="text-2xs text-muted-foreground">
                  Ask a team admin to create the first project.
                </p>
              )
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((project) => (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="card-hover group rounded-lg border border-border bg-card/40 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-sm font-medium text-foreground">{project.name}</h2>
                      <StatusBadge status={project.health} dot={false} />
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-muted-foreground">
                      {project.description || 'No description yet.'}
                    </p>
                  </div>
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{project.environment.toLowerCase()}</Badge>
                  {project.openIncidents > 0 ? (
                    <Badge variant="critical">{project.openIncidents} open incidents</Badge>
                  ) : null}
                </div>

                <div className="mt-4 grid grid-cols-4 gap-2 border-t border-border/60 pt-3 text-center">
                  {[
                    ['Services', project._count.services],
                    ['Monitors', project._count.monitors],
                    ['Errors', project._count.errorGroups],
                    ['Integrations', project._count.integrations],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <p className="text-sm font-medium tabular-nums">{value}</p>
                      <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        {label}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between text-2xs text-muted-foreground">
                  <span className="font-mono">key {project.ingestionKeyPrefix}…</span>
                  <span>{dateTime(project.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a project</DialogTitle>
            <DialogDescription>
              Projects isolate telemetry within your team. A new ingestion key is generated and
              displayed once.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createProject.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Payments API"
                minLength={2}
                maxLength={80}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Public checkout and payment intents"
                maxLength={500}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-environment">Default environment</Label>
              <NativeSelect
                id="project-environment"
                value={environment}
                onChange={(event) => setEnvironment(event.target.value as Environment)}
              >
                <option value="PRODUCTION">Production</option>
                <option value="STAGING">Staging</option>
                <option value="DEVELOPMENT">Development</option>
                <option value="TEST">Test</option>
              </NativeSelect>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createProject.isPending} disabled={name.trim().length < 2}>
                Create project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(created)}
        onOpenChange={(open) => {
          if (!open) setCreated(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Store this ingestion key now</DialogTitle>
            <DialogDescription>
              Outpost stores only a SHA-256 hash. This is the only time the full key is shown.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2 rounded-md border border-warning/25 bg-warning/5 p-3 text-xs leading-relaxed text-warning">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              Treat this like a secret. Rotate it from the project page if it leaks.
            </div>
            <div className="rounded-md border border-border bg-[#0c0f0b] p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                <KeyRound className="size-3" /> Ingestion key
              </p>
              <code className="block break-all font-mono text-2xs text-success">
                {created?.ingestionKey}
              </code>
              <div className="mt-2 flex items-center gap-2">
                <CopyButton value={created?.ingestionKey ?? ''} label="Copy key" />
                <span className="text-2xs text-muted-foreground">{created?.name}</span>
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-secondary/20 p-3 text-2xs leading-relaxed text-muted-foreground">
              Send errors with header <code className="font-mono text-foreground">X-Outpost-Key</code>{' '}
              to <code className="font-mono text-foreground">POST /v1/ingest/errors</code>. The
              NestJS SDK batches and sanitizes events automatically.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreated(null)}>
              Close
            </Button>
            <Button
              onClick={() => {
                const projectId = created?.id;
                setCreated(null);
                if (projectId) navigate(`/projects/${projectId}`);
              }}
            >
              Open project <ArrowRight />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
