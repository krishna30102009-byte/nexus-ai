/**
 * NexusAI Shared Types - Professional Criminal Intelligence Platform
 * Single source of truth for frontend/backend contracts
 */

// ============================================
// AUTH & USER MANAGEMENT
// ============================================

export type UserRole = 'officer' | 'police' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  badgeNumber?: string;
  department?: string;
  createdAt: string;
  lastLoginAt?: string;
  isActive: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData extends LoginCredentials {
  name: string;
  role: UserRole;
  badgeNumber?: string;
  department?: string;
}

// ============================================
// ENTITY TYPES (Core Intelligence)
// ============================================

export type EntityType = 
  | 'person' 
  | 'phone' 
  | 'device' 
  | 'location' 
  | 'vehicle' 
  | 'account' 
  | 'organization' 
  | 'document' 
  | 'ip_address' 
  | 'email' 
  | 'crypto_wallet';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'monitored';

export interface BaseEntity {
  id: string;
  type: EntityType;
  name: string;
  riskScore: number;           // 0-100
  riskLevel: RiskLevel;
  confidence: number;          // 0-100 AI confidence
  tags: string[];
  sourceIds: string[];         // FIR, CDR, Financial record IDs
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  isActive: boolean;
}

export interface PersonEntity extends BaseEntity {
  type: 'person';
  aliases: string[];
  criminalId?: string;         // CR-XXXX-XXXX-XXXX
  firNumbers: string[];
  cnrNumbers: string[];
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'other';
  nationality?: string;
  addresses: Address[];
  phones: string[];            // Phone entity IDs
  vehicles: string[];          // Vehicle entity IDs
  accounts: string[];          // Account entity IDs
  organizations: string[];     // Organization entity IDs
  knownAssociates: string[];   // Person entity IDs
  physicalDescription?: string;
  biometrics?: BiometricData;
  criminalHistory: CriminalRecord[];
}

export interface PhoneEntity extends BaseEntity {
  type: 'phone';
  number: string;              // Masked for display
  imsi?: string;
  imei?: string;
  carrier?: string;
  subscriberId?: string;       // Person entity ID
  callRecords: CallRecord[];
  locationHistory: LocationPing[];
}

export interface DeviceEntity extends BaseEntity {
  type: 'device';
  deviceId: string;
  deviceType: 'mobile' | 'tablet' | 'laptop' | 'iot' | 'unknown';
  os?: string;
  macAddresses: string[];
  ipHistory: IPRecord[];
  subscriberId?: string;
  appsInstalled?: string[];
}

export interface LocationEntity extends BaseEntity {
  type: 'location';
  coordinates: { lat: number; lng: number };
  address: Address;
  locationType: 'residence' | 'business' | 'warehouse' | 'meeting_point' | 'transit' | 'border' | 'other';
  geofenceRadius?: number;
  associatedEntities: string[]; // Entity IDs frequently here
  visitPatterns: VisitPattern[];
}

export interface VehicleEntity extends BaseEntity {
  type: 'vehicle';
  registrationNumber: string;  // DL-8C-XXXX
  vehicleType: 'car' | 'bike' | 'truck' | 'van' | 'other';
  make?: string;
  model?: string;
  color?: string;
  ownerId?: string;            // Person entity ID
  tollRecords: TollRecord[];
  sightings: VehicleSighting[];
}

export interface AccountEntity extends BaseEntity {
  type: 'account';
  accountNumber: string;       // Masked
  bankName?: string;
  accountType: 'savings' | 'current' | 'shell' | 'crypto' | 'offshore' | 'other';
  currency: string;
  balance?: number;
  ownerIds: string[];          // Person entity IDs
  transactions: Transaction[];
  beneficiaryAccounts: string[]; // Account entity IDs
}

export interface OrganizationEntity extends BaseEntity {
  type: 'organization';
  registrationNumber?: string;
  orgType: 'company' | 'shell' | 'ngo' | 'trust' | 'partnership' | 'other';
  directors: string[];         // Person entity IDs
  shareholders: string[];
  addresses: Address[];
  financials?: FinancialSummary;
}

export interface DocumentEntity extends BaseEntity {
  type: 'document';
  docType: 'fir' | 'cdr' | 'financial' | 'surveillance' | 'intel_report' | 'warrant' | 'court_order' | 'other';
  title: string;
  filePath: string;
  mimeType: string;
  size: number;
  extractedEntities: string[]; // Entity IDs extracted via NLP
  summary?: string;
  classification: 'classified' | 'restricted' | 'internal' | 'public';
  caseId?: string;
}

export interface IPAddressEntity extends BaseEntity {
  type: 'ip_address';
  ip: string;
  isp?: string;
  geolocation?: { lat: number; lng: number; city: string; country: string };
  associatedDevices: string[];
  activityLog: IPActivity[];
}

export interface EmailEntity extends BaseEntity {
  type: 'email';
  address: string;
  domain: string;
  subscriberId?: string;
  emailHeaders: EmailHeader[];
  contacts: string[];          // Email entity IDs
}

export interface CryptoWalletEntity extends BaseEntity {
  type: 'crypto_wallet';
  address: string;
  blockchain: 'btc' | 'eth' | 'usdt' | 'other';
  balance?: number;
  transactions: CryptoTransaction[];
  knownExchanges: string[];
}

export type Entity = 
  | PersonEntity 
  | PhoneEntity 
  | DeviceEntity 
  | LocationEntity 
  | VehicleEntity 
  | AccountEntity 
  | OrganizationEntity 
  | DocumentEntity 
  | IPAddressEntity 
  | EmailEntity 
  | CryptoWalletEntity;

// Supporting types
export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  formatted: string;
}

export interface BiometricData {
  fingerprints?: string[];
  facialRecognition?: string;
  dnaProfile?: string;
}

export interface CriminalRecord {
  firNumber: string;
  date: string;
  charges: string[];
  status: 'pending' | 'convicted' | 'acquitted' | 'dismissed';
  sentence?: string;
}

export interface CallRecord {
  id: string;
  direction: 'incoming' | 'outgoing' | 'missed';
  counterpartNumber: string;
  counterpartEntityId?: string;
  timestamp: string;
  duration: number;
  cellTowerId?: string;
  location?: { lat: number; lng: number };
  isAnalyzed: boolean;
}

export interface LocationPing {
  timestamp: string;
  coordinates: { lat: number; lng: number };
  accuracy: number;
  source: 'cell_tower' | 'gps' | 'wifi' | 'ip';
}

export interface IPRecord {
  ip: string;
  timestamp: string;
  activity: string;
  deviceId?: string;
}

export interface VisitPattern {
  entityId: string;
  frequency: number;
  avgDuration: number;
  commonHours: number[];
  lastVisit: string;
}

export interface TollRecord {
  plazaId: string;
  plazaName: string;
  timestamp: string;
  amount: number;
  entryExit: 'entry' | 'exit';
  coordinates: { lat: number; lng: number };
}

export interface VehicleSighting {
  timestamp: string;
  coordinates: { lat: number; lng: number };
  source: 'camera' | 'anpr' | 'toll' | 'manual';
  confidence: number;
}

export interface Transaction {
  id: string;
  timestamp: string;
  amount: number;
  currency: string;
  type: 'credit' | 'debit' | 'transfer_in' | 'transfer_out' | 'cash_deposit' | 'cash_withdrawal';
  counterpartyAccount: string;
  counterpartyEntityId?: string;
  counterpartyName?: string;
  reference: string;
  channel: 'neft' | 'rtgs' | 'imps' | 'upi' | 'cash' | 'card' | 'crypto' | 'other';
  isFlagged: boolean;
  flagReason?: string;
}

export interface FinancialSummary {
  revenue?: number;
  expenses?: number;
  netWorth?: number;
  lastFilingDate?: string;
}

export interface EmailHeader {
  messageId: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  timestamp: string;
  inReplyTo?: string;
}

export interface IPActivity {
  timestamp: string;
  activity: string;
  deviceId?: string;
  userAgent?: string;
}

export interface CryptoTransaction {
  hash: string;
  timestamp: string;
  fromAddress: string;
  toAddress: string;
  amount: number;
  token: string;
  usdValue?: number;
  isFlagged: boolean;
}

// ============================================
// RELATIONSHIPS & NETWORK
// ============================================

export type RelationshipType = 
  | 'calls' 
  | 'messaged' 
  | 'met_with' 
  | 'transferred_to' 
  | 'transferred_from' 
  | 'owns' 
  | 'registered_at' 
  | 'works_for' 
  | 'associated_with' 
  | 'family_of' 
  | 'co_located' 
  | 'shared_device' 
  | 'shared_ip' 
  | 'crypto_transfer' 
  | 'email_contact' 
  | 'social_media' 
  | 'witness' 
  | 'suspect_of';

export interface Relationship {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  type: RelationshipType;
  strength: number;            // 0-100
  confidence: number;          // 0-100
  evidenceIds: string[];       // Document/Record IDs supporting this
  firstObserved: string;
  lastObserved: string;
  isActive: boolean;
  metadata: Record<string, any>;
}

export interface NetworkGraph {
  nodes: Entity[];
  edges: Relationship[];
  metadata: {
    totalEntities: number;
    totalRelationships: number;
    density: number;
    clusters: Cluster[];
    centrality: CentralityScores;
  };
}

export interface Cluster {
  id: string;
  entityIds: string[];
  label: string;
  riskLevel: RiskLevel;
  centralEntityId: string;
}

export interface CentralityScores {
  betweenness: Record<string, number>;
  closeness: Record<string, number>;
  degree: Record<string, number>;
  eigenvector: Record<string, number>;
  pagerank: Record<string, number>;
}

// ============================================
// CASES & INVESTIGATIONS
// ============================================

export type CaseStatus = 'open' | 'active' | 'under_review' | 'closed' | 'cold' | 'archived';
export type CasePriority = 'critical' | 'high' | 'medium' | 'low';

export interface Case {
  id: string;
  caseNumber: string;          // e.g., NTF-042
  firNumber?: string;
  cnrNumber?: string;
  title: string;
  description: string;
  status: CaseStatus;
  priority: CasePriority;
  assignedTo: string[];        // User IDs
  entities: string[];          // Entity IDs
  documents: string[];         // Document entity IDs
  timeline: TimelineEvent[];
  notes: CaseNote[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  tags: string[];
}

export interface TimelineEvent {
  id: string;
  caseId: string;
  timestamp: string;
  type: 'entity_added' | 'relationship_found' | 'document_uploaded' | 'note_added' | 'status_changed' | 'alert_triggered' | 'simulation_run' | 'search_performed';
  title: string;
  description: string;
  entityIds?: string[];
  documentIds?: string[];
  userId: string;
  metadata: Record<string, any>;
}

export interface CaseNote {
  id: string;
  caseId: string;
  userId: string;
  content: string;
  isPrivate: boolean;
  attachments: string[];
  createdAt: string;
  updatedAt: string;
}

// ============================================
// ALERTS & SIGNALS
// ============================================

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AlertType = 
  | 'anomaly' 
  | 'pattern' 
  | 'threshold' 
  | 'new_entity' 
  | 'relationship' 
  | 'geofence' 
  | 'financial' 
  | 'communication' 
  | 'movement' 
  | 'risk_change';

export interface Alert {
  id: string;
  caseId?: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  entityIds: string[];
  confidence: number;
  source: 'ai_model' | 'rule_engine' | 'manual' | 'external_feed';
  status: 'new' | 'acknowledged' | 'investigating' | 'resolved' | 'dismissed';
  assignedTo?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  createdAt: string;
  metadata: Record<string, any>;
}

// ============================================
// SIMULATION & PREDICTIVE
// ============================================

export interface SimulationRequest {
  type: 'detention' | 'removal' | 'surveillance' | 'asset_freeze' | 'network_disruption';
  targetEntityIds: string[];
  parameters: Record<string, any>;
  requestedBy: string;
}

export interface SimulationResult {
  id: string;
  request: SimulationRequest;
  result: {
    networkResilience: number;     // 0-100
    clusterCount: number;
    isolatedEntities: string[];
    disruptedFlows: DisruptedFlow[];
    riskPropagation: RiskPropagation[];
    timeToRecovery?: number;       // days
    recommendations: string[];
  };
  createdAt: string;
  status: 'running' | 'completed' | 'failed';
}

export interface DisruptedFlow {
  fromEntityId: string;
  toEntityId: string;
  flowType: 'financial' | 'communication' | 'logistics';
  impact: 'total' | 'partial' | 'minimal';
}

export interface RiskPropagation {
  entityId: string;
  currentRisk: number;
  projectedRisk: number;
  timeframe: string;
}

// ============================================
// SEARCH & QUERY
// ============================================

export interface SearchQuery {
  query: string;
  type?: 'entity' | 'case' | 'document' | 'relationship' | 'all';
  entityTypes?: EntityType[];
  riskLevels?: RiskLevel[];
  dateRange?: { from: string; to: string };
  caseId?: string;
  filters: Record<string, any>;
  page: number;
  limit: number;
  sortBy: 'relevance' | 'risk' | 'date' | 'name';
  sortOrder: 'asc' | 'desc';
}

export interface SearchResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  facets: SearchFacets;
  queryTime: number;
}

export interface SearchFacets {
  entityTypes: Record<EntityType, number>;
  riskLevels: Record<RiskLevel, number>;
  sources: Record<string, number>;
  dateHistogram: { date: string; count: number }[];
}

// ============================================
// ANALYTICS & REPORTING
// ============================================

export interface AnalyticsDashboard {
  kpis: KPI[];
  trends: TrendData[];
  heatmaps: HeatmapData[];
  charts: ChartData[];
}

export interface KPI {
  id: string;
  label: string;
  value: number | string;
  change: number;              // percentage
  trend: 'up' | 'down' | 'stable';
  period: string;
  target?: number;
  status: 'on_track' | 'at_risk' | 'off_track';
}

export interface TrendData {
  label: string;
  data: { date: string; value: number }[];
  metric: string;
}

export interface HeatmapData {
  type: 'geolocation' | 'communication' | 'financial' | 'temporal';
  data: { lat: number; lng: number; weight: number; entityId?: string }[];
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

export interface ChartData {
  id: string;
  type: 'line' | 'bar' | 'pie' | 'radar' | 'sankey' | 'network';
  title: string;
  data: any;
  options: Record<string, any>;
}

// ============================================
// AI COPILOT
// ============================================

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  language: 'en' | 'hi' | 'hinglish';
  citations: Citation[];
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface Citation {
  entityId: string;
  entityName: string;
  entityType: EntityType;
  documentId?: string;
  excerpt: string;
  relevance: number;
}

export interface CopilotQuery {
  question: string;
  language: 'en' | 'hi' | 'hinglish';
  context?: {
    caseId?: string;
    entityIds?: string[];
    recentMessages?: CopilotMessage[];
  };
}

export interface CopilotResponse {
  answer: string;
  language: 'en' | 'hi' | 'hinglish';
  citations: Citation[];
  suggestedFollowUps: string[];
  actions: CopilotAction[];
  confidence: number;
}

export type CopilotActionType = 
  | 'open_entity' 
  | 'open_case' 
  | 'run_simulation' 
  | 'show_network' 
  | 'create_alert' 
  | 'export_report' 
  | 'search';

export interface CopilotAction {
  type: CopilotActionType;
  label: string;
  payload: Record<string, any>;
  primary: boolean;
}

// ============================================
// AUDIT & COMPLIANCE
// ============================================

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, any>;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
  outcome: 'success' | 'failure' | 'partial';
  riskScore: number;
}

// ============================================
// DATA SOURCES & INGESTION
// ============================================

export type DataSourceType = 'cdr' | 'fir' | 'financial' | 'surveillance' | 'social_media' | 'intel_report' | 'border' | 'custom';

export interface DataSource {
  id: string;
  name: string;
  type: DataSourceType;
  config: Record<string, any>;
  status: 'active' | 'inactive' | 'error' | 'syncing';
  lastSyncAt?: string;
  nextSyncAt?: string;
  totalRecords: number;
  errorMessage?: string;
  createdBy: string;
  createdAt: string;
}

export interface IngestionJob {
  id: string;
  dataSourceId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

// ============================================
// API RESPONSE WRAPPERS
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  statusCode: number;
}

export interface ResponseMeta {
  timestamp: string;
  requestId: string;
  version: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: ResponseMeta & { pagination: Required<ResponseMeta['pagination']> };
}

// ============================================
// WEBSOCKET EVENTS
// ============================================

export type WSEventType = 
  | 'alert:new' 
  | 'alert:updated' 
  | 'entity:created' 
  | 'entity:updated' 
  | 'case:updated' 
  | 'simulation:complete' 
  | 'ingestion:progress' 
  | 'system:notification';

export interface WSEvent<T = any> {
  type: WSEventType;
  payload: T;
  timestamp: string;
  userId?: string;
}

export interface WSAuthMessage {
  type: 'auth';
  token: string;
}

export interface WSSubscribeMessage {
  type: 'subscribe';
  channels: string[];
}

export interface WSUnsubscribeMessage {
  type: 'unsubscribe';
  channels: string[];
}

// ============================================
// CONFIGURATION
// ============================================

export interface AppConfig {
  app: {
    name: string;
    version: string;
    environment: 'development' | 'staging' | 'production';
  };
  auth: {
    jwtSecret: string;
    accessTokenExpiry: string;    // e.g., '15m'
    refreshTokenExpiry: string;   // e.g., '7d'
    bcryptRounds: number;
  };
  database: {
    type: 'sqlite' | 'postgresql';
    path?: string;
    host?: string;
    port?: number;
    name?: string;
    user?: string;
    password?: string;
    ssl?: boolean;
  };
  redis?: {
    host: string;
    port: number;
    password?: string;
  };
  storage: {
    uploadPath: string;
    maxFileSize: number;
    allowedMimeTypes: string[];
  };
  ai: {
    copilotModel: string;
    confidenceThreshold: number;
    maxContextMessages: number;
  };
  websocket: {
    port: number;
    pingInterval: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    filePath: string;
  };
}