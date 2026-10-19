export type TeamRole = 'OWNER' | 'ADMIN' | 'VIEWER';
export type Environment = 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT' | 'TEST';
export type IntegrationType = 'SUPABASE' | 'POSTGRESQL' | 'MYSQL';
export type IntegrationStatus = 'PENDING' | 'CONNECTED' | 'ERROR' | 'PAUSED';
export type MonitorMethod = 'GET' | 'HEAD';
export type MonitorHealth = 'UNKNOWN' | 'UP' | 'DOWN';
export type EgressMode = 'DEFAULT' | 'PROXY' | 'REGION';
export type RunStatus = 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'CONNECTION_ERROR';
export type ErrorSeverity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO';
export type ErrorStatus = 'UNRESOLVED' | 'RESOLVED' | 'IGNORED';
export type IncidentType =
  | 'DOWNTIME'
  | 'HIGH_LATENCY'
  | 'DATABASE'
  | 'HEARTBEAT_FAILURE'
  | 'ERROR_SPIKE';
export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AlertEventType =
  | 'DOWNTIME'
  | 'RECOVERY'
  | 'HIGH_LATENCY'
  | 'DATABASE_CONNECTION_FAILURE'
  | 'HEARTBEAT_FAILURE'
  | 'NEW_ERROR'
  | 'INCIDENT_CREATED';
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED';
export type ReportType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
export type ReportStatus = 'PENDING' | 'GENERATING' | 'COMPLETED' | 'FAILED';
export type ReportFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type HeartbeatStatus = 'SUCCESS' | 'FAILURE';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface TeamMembership {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  retentionDays?: number;
  createdAt: string;
  role: TeamRole;
  membershipId: string;
  _count?: { projects: number; members: number };
}

export interface AuthMe {
  user: UserProfile;
  teams: TeamMembership[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** @deprecated Use Page<T>. */
export type Paginated<T> = Page<T>;

export interface ProjectCounts {
  services: number;
  monitors: number;
  errorGroups: number;
  integrations: number;
  reports?: number;
}

export interface ProjectListItem {
  id: string;
  name: string;
  description: string | null;
  environment: Environment;
  ingestionKeyPrefix: string;
  createdAt: string;
  updatedAt: string;
  health: 'UP' | 'DOWN' | 'PARTIAL' | 'UNKNOWN';
  openIncidents: number;
  monitors: number;
  _count: ProjectCounts;
}

export interface ProjectSummary {
  id: string;
  teamId?: string;
  name: string;
  description: string | null;
  environment: Environment;
  ingestionKeyPrefix: string;
  createdAt: string;
  _count?: { services: number };
}

export interface Service {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  environment: Environment;
  runtime: string | null;
  createdAt: string;
  _count?: { monitors: number; errors?: number };
  monitors?: Array<{
    id: string;
    name: string;
    lastStatus: MonitorHealth;
    lastCheckedAt: string | null;
    active: boolean;
  }>;
}

export interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  environment: Environment;
  ingestionKeyPrefix: string;
  createdAt: string;
  updatedAt: string;
  _count: Required<ProjectCounts>;
  services: Service[];
  integrations: Integration[];
}

export interface Monitor {
  id: string;
  projectId: string;
  serviceId: string | null;
  name: string;
  url: string;
  method: MonitorMethod;
  expectedStatusCodes: number[];
  timeoutMs: number;
  intervalSeconds: number;
  active: boolean;
  egressMode: EgressMode;
  region: string | null;
  failureThreshold: number;
  consecutiveFailures: number;
  lastStatus: MonitorHealth;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  service?: { id: string; name: string } | null;
  project?: { id: string; name: string; environment: Environment };
  _count?: { runs: number };
  incidents?: Array<{
    id: string;
    title: string;
    severity: IncidentSeverity;
    startedAt: string;
  }>;
  uptime24h?: number;
  avgLatency24h?: number | null;
  checks24h?: number;
  openIncident?: Incident | null;
  runs?: MonitorRun[];
}

export interface MonitorRun {
  id: string;
  monitorId: string;
  status: RunStatus;
  statusCode: number | null;
  latencyMs: number | null;
  egress?: string | null;
  error: string | null;
  checkedAt: string;
  monitor?: {
    id: string;
    name: string;
    url: string;
    project: { id: string; name: string; environment: Environment };
  };
}

export interface HealthOverview {
  summary: {
    total: number;
    up: number;
    down: number;
    unknown: number;
    uptime24h: number;
    avgLatency24h: number | null;
    openIncidents: number;
    checks24h: number;
  };
  monitors: Monitor[];
  recentFailures: MonitorRun[];
  timeline: Array<{
    timestamp: string;
    uptime: number;
    latencyMs: number | null;
    checks: number;
  }>;
  incidents: Array<{
    id: string;
    monitorId: string | null;
    title: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    startedAt: string;
  }>;
}

export interface MonitorStats {
  range: string;
  totalChecks: number;
  successfulChecks: number;
  uptime: number;
  avgLatency: number | null;
  p95Latency: number | null;
  series: Array<{
    timestamp: string;
    uptime: number;
    latencyMs: number | null;
    checks: number;
  }>;
}

export interface MonitorRunsResponse extends Page<MonitorRun> {
  monitor: { id: string; name: string; url: string };
}

export interface EgressOptions {
  default: boolean;
  proxy: { enabled: boolean; count: number };
  regions: string[];
}

export interface Incident {
  id: string;
  projectId: string;
  monitorId: string | null;
  integrationId: string | null;
  type: IncidentType;
  status: IncidentStatus;
  severity: IncidentSeverity;
  title: string;
  summary: string;
  startedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  metadata: Record<string, unknown> | null;
  project?: { id: string; name: string; environment: Environment };
  monitor?: { id: string; name: string; url: string; method?: MonitorMethod } | null;
  integration?: { id: string; name: string; type: IntegrationType } | null;
}

export interface IncidentSummary {
  open: number;
  acknowledged: number;
  resolved24h: number;
  critical: number;
}

export interface ErrorGroup {
  id: string;
  projectId: string;
  fingerprint: string;
  errorType: string;
  message: string;
  serviceName: string;
  environment: Environment;
  severity: ErrorSeverity;
  status: ErrorStatus;
  eventCount: number;
  firstSeen: string;
  lastSeen: string;
  stackSample: string | null;
  lastAlertedAt: string | null;
  project?: { id: string; name: string; environment: Environment };
  events?: ErrorEvent[];
}

export interface ErrorEvent {
  id: string;
  projectId: string;
  errorGroupId: string;
  serviceId: string | null;
  fingerprint: string;
  errorType: string;
  message: string;
  stackTrace: string | null;
  serviceName: string;
  environment: Environment;
  httpStatus: number | null;
  path: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface ErrorOverview {
  summary: {
    unresolvedGroups: number;
    totalEvents: number;
    events24h: number;
    resolvedGroups: number;
    resolutionRate: number;
  };
  severity: Array<{ severity: ErrorSeverity; groups: number; events: number }>;
  topServices: Array<{ serviceName: string; events: number }>;
  timeline: Array<{ timestamp: string; count: number }>;
}

export interface Integration {
  id: string;
  projectId: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  credentialHint: string | null;
  heartbeatEnabled: boolean;
  heartbeatIntervalMinutes: number;
  heartbeatNextRunAt: string | null;
  heartbeatLastSuccessAt: string | null;
  heartbeatLastAttemptAt: string | null;
  heartbeatConsecutiveFailures: number;
  metricsEnabled: boolean;
  metricsIntervalMinutes: number;
  metricsNextRunAt: string | null;
  metricsConsecutiveFailures: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string; environment: Environment };
  latestMetric?: DatabaseMetric | null;
  trend?: Array<{
    timestamp: string;
    connectivity: boolean;
    connectionLatencyMs: number | null;
    activeConnections: number | null;
    databaseSizeBytes: number | null;
    locks: number | null;
  }>;
}

export interface DatabaseMetric {
  id: string;
  integrationId: string;
  connectivity: boolean;
  connectionLatencyMs: number | null;
  activeConnections: number | null;
  maxConnections: number | null;
  databaseSizeBytes: number | null;
  longRunningQueries: number | null;
  locks: number | null;
  slowQueries: Array<{
    query: string;
    calls: number;
    totalExecTimeMs: number;
    meanExecTimeMs: number;
    rows: number;
  }> | null;
  transactionStats: {
    commits: number;
    rollbacks: number;
    blocksRead: number;
    blocksHit: number;
  } | null;
  unavailableReasons: Record<string, string> | null;
  error: string | null;
  collectedAt: string;
}

export interface DatabaseOverview {
  integrations: Integration[];
  summary: {
    connectedDatabases: number;
    reachable: number;
    configuredForMetrics: number;
    activeConnections24h: number | null;
    totalSizeBytes: number | null;
  };
  setupNotes: string[];
}

export interface DatabaseMetricsResponse {
  integration: Integration;
  latest: DatabaseMetric | null;
  metrics: DatabaseMetric[];
  setupNotes: string[];
}

export interface HeartbeatSummary {
  integration: Integration;
  runs: HeartbeatRun[];
  totals: {
    last24h: number;
    success24h: number;
    failed24h: number;
    successRate: number | null;
  };
}

export interface HeartbeatRun {
  id: string;
  integrationId: string;
  status: HeartbeatStatus;
  latencyMs: number | null;
  statusCode: number | null;
  error: string | null;
  executedAt: string;
}

export interface HeartbeatRunResult {
  id: string;
  projectId: string;
  status: HeartbeatStatus;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  executedAt: string;
}

export interface HeartbeatVerifyResult {
  connected: boolean;
  status: HeartbeatStatus;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  message: string;
}

export interface AlertRule {
  id: string;
  projectId: string;
  type: AlertEventType;
  enabled: boolean;
  cooldownMinutes: number;
  failureThreshold: number;
  latencyThresholdMs: number | null;
  recipients: string[];
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string };
}

export interface NotificationChannel {
  id: string;
  teamId: string;
  name: string;
  type: 'EMAIL';
  config: { emails: string[] };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDelivery {
  id: string;
  recipient: string;
  subject: string;
  status: NotificationStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  alertRule?: { type: AlertEventType; project: { id: string; name: string } } | null;
  report?: { id: string; name: string } | null;
}

export interface Report {
  id: string;
  projectId: string;
  name: string;
  type: ReportType;
  status: ReportStatus;
  periodStart: string;
  periodEnd: string;
  sizeBytes: number | null;
  generatedAt: string | null;
  createdAt: string;
  updatedAt?: string;
  error: string | null;
  emailRecipients: string[];
  createdBy?: { id: string; fullName: string | null; email: string } | null;
  project: { id: string; name: string; environment: Environment };
  _count?: { shares: number };
  shares?: ReportShare[];
  snapshot?: ReportSnapshot | null;
}

export interface ReportShare {
  id: string;
  tokenPrefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  createdBy?: { fullName: string | null; email: string } | null;
}

export interface ReportShareCreated extends ReportShare {
  url: string;
  token: string;
}

export interface ReportSchedule {
  id: string;
  projectId: string;
  name: string;
  frequency: ReportFrequency;
  enabled: boolean;
  recipients: string[];
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string; environment: Environment };
}

export interface ReportSnapshot {
  version: number;
  project: { name: string; environment: string; description: string | null };
  period: { start: string; end: string };
  generatedAt: string;
  summary: {
    monitors: number;
    healthyMonitors: number;
    uptime: number | null;
    avgResponseMs: number | null;
    peakResponseMs: number | null;
    errorEvents: number;
    unresolvedErrorGroups: number;
    openIncidents: number;
    resolvedIncidents: number;
    heartbeatExecutions: number;
    heartbeatFailures: number;
    connectedDatabases: number;
    monitoringAvailability: number | null;
    expectedChecks: number;
    recordedChecks: number;
  };
  monitors: Array<{
    name: string;
    service: string | null;
    method: string;
    intervalSeconds: number;
    uptime: number;
    totalChecks: number;
    successfulChecks: number;
    avgResponseMs: number | null;
    peakResponseMs: number | null;
    lastStatus: string;
    expectedChecks: number;
    availability: number | null;
  }>;
  errorBreakdown: Array<{
    errorType: string;
    serviceName: string;
    severity: string;
    status: string;
    events: number;
  }>;
  errorTrend: Array<{ date: string; count: number }>;
  databases: Array<{
    name: string;
    connectivity: boolean | null;
    avgConnectionLatencyMs: number | null;
    peakActiveConnections: number | null;
    databaseSizeBytes: number | null;
    longRunningQueries: number | null;
    locks: number | null;
    samples: number;
    failedSamples: number;
    unavailableReasons: string[];
    collectedAt: string | null;
  }>;
  incidents: Array<{
    title: string;
    type: string;
    severity: string;
    status: string;
    startedAt: string;
    resolvedAt: string | null;
    durationMinutes: number | null;
  }>;
  heartbeats: Array<{
    name: string;
    executions: number;
    failures: number;
    successRate: number | null;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
  }>;
  monitoringTimeline: Array<{
    date: string;
    checks: number;
    uptime: number;
    avgLatencyMs: number | null;
  }>;
  dataNotes: string[];
}

export interface PublicReportShare {
  share: { expiresAt: string | null; createdAt: string };
  report: {
    name: string;
    type: ReportType;
    periodStart: string;
    periodEnd: string;
    generatedAt: string | null;
  };
  project: { name: string; environment: Environment };
  snapshot: ReportSnapshot;
}

export interface TeamDetail {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  retentionDays: number;
  createdAt: string;
  updatedAt: string;
  currentRole: TeamRole;
  owner: { id: string; fullName: string | null; email: string };
  _count: { projects: number; members: number };
}

export interface TeamMember {
  id: string;
  role: TeamRole;
  createdAt: string;
  user: { id: string; fullName: string | null; email: string; avatarUrl: string | null };
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: TeamRole;
  status: string;
  expiresAt: string;
  createdAt: string;
  invitedBy?: { fullName: string | null; email: string } | null;
}

export interface MyPendingInvitation {
  id: string;
  role: TeamRole;
  expiresAt: string;
  createdAt: string;
  team: { name: string; slug: string };
  invitedBy?: { fullName: string | null; email: string } | null;
}

export interface InvitationPreview {
  team: { name: string; slug: string };
  email: string;
  role: TeamRole;
  expiresAt: string;
  invitedBy?: string | null;
}

export interface InvitationCreated {
  invitation: { email: string; role: TeamRole; expiresAt: string; status: string };
  emailDelivered: boolean;
  emailError: string | null;
  inviteUrl?: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  projectId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  actor?: { id: string; fullName: string | null; email: string } | null;
}

export interface ProjectDashboard {
  project: ProjectSummary;
  summary: {
    services: number;
    monitors: number;
    healthy: number;
    down: number;
    unknown: number;
    activeIncidents: number;
    unresolvedErrorGroups: number;
    errorEvents: number;
    uptime: number;
    avgLatency: number | null;
    lastHeartbeat: {
      status: HeartbeatStatus;
      executedAt: string;
      integrationId: string;
    } | null;
  };
  monitors: Array<
    Pick<
      Monitor,
      | 'id'
      | 'name'
      | 'url'
      | 'lastStatus'
      | 'lastCheckedAt'
      | 'lastLatencyMs'
      | 'active'
      | 'intervalSeconds'
      | 'service'
    >
  >;
  integrations: Array<
    Pick<
      Integration,
      | 'id'
      | 'name'
      | 'type'
      | 'status'
      | 'heartbeatEnabled'
      | 'heartbeatIntervalMinutes'
      | 'heartbeatLastSuccessAt'
      | 'metricsEnabled'
      | 'metricsIntervalMinutes'
      | 'lastError'
    > & { latestMetrics: DatabaseMetric | null }
  >;
  incidents: Array<{
    id: string;
    title: string;
    type: IncidentType;
    severity: IncidentSeverity;
    status: IncidentStatus;
    startedAt: string;
  }>;
  recentErrors: Array<{
    id: string;
    errorType: string;
    message: string;
    serviceName: string;
    severity: ErrorSeverity;
    eventCount: number;
    lastSeen: string;
  }>;
  latencySeries: Array<{ timestamp: string; latencyMs: number }>;
  metrics: Array<{
    id: string;
    integrationId: string;
    connectivity: boolean;
    connectionLatencyMs: number | null;
    activeConnections: number | null;
    databaseSizeBytes: number | null;
    locks: number | null;
    collectedAt: string;
  }>;
}

export interface AlertTestResult {
  status: NotificationStatus;
  attempts: number;
  message: string;
}
