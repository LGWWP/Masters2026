export type ConciergeRequestStatus = 'idle' | 'sending' | 'confirmed' | 'failed';

export type ConciergeConfig = { apiUrl: string; roomId: string; authToken: string };

export const conciergeConfigState = $state<{ current: ConciergeConfig | null }>({ current: null });

export function applyConciergeConfig(config: ConciergeConfig | null): void {
  const previous = conciergeConfigState.current;
  if (previous?.apiUrl === config?.apiUrl && previous?.roomId === config?.roomId &&
      previous?.authToken === config?.authToken) return;
  conciergeConfigState.current = config;
}

export type ConciergeService = {
  uid: string;
  name: string;
  description: string;
  icon: string;
};

export type ConciergeRequest = ConciergeService & {
  status: ConciergeRequestStatus;
  message: string;
};

export const DEFAULT_OFFLINE_MESSAGE = 'Concierge is currently unavailable. Please contact reception for assistance.';

export const conciergeState = $state<{
  status: 'loading' | 'online' | 'offline' | 'error';
  message: string;
  notice: string;
  offlineMessage: string;
  requests: ConciergeRequest[];
}>({
  status: 'loading',
  message: '',
  notice: '',
  offlineMessage: DEFAULT_OFFLINE_MESSAGE,
  requests: []
});

export function applyConciergeServices(services: ConciergeService[], offlineMessage: string): void {
  const previous = conciergeState.requests;
  conciergeState.requests = services.map((service) => {
    const request = previous.find((item) => item.uid === service.uid);
    if (request) {
      Object.assign(request, service);
      return request;
    }
    return { ...service, status: 'idle', message: '' };
  });
  conciergeState.offlineMessage = offlineMessage;
}
