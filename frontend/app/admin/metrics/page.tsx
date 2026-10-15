import type { Metadata } from 'next';
import MetricsDashboard from './MetricsDashboard';

export const metadata: Metadata = {
  title: 'Production metrics',
  description: 'Live service health, request performance and server resources from Prometheus',
};

export default function MetricsPage() {
  return <MetricsDashboard />;
}
