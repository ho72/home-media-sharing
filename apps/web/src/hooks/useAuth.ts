import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';

export interface DisplayPreferences {
  sortDefault?: 'taken_desc' | 'taken_asc' | 'uploaded_desc';
  gridSize?: 'small' | 'medium' | 'large';
}

export interface Me {
  id: string;
  displayName: string;
  isAdmin: boolean;
  unipassUserId: string;
  unipassLinkedAt: string | null;
  unipassHandle: string | null;
  unipassAvatarUrl: string | null;
  displayPreferences: DisplayPreferences | null;
}

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: 'always',
    retry: false,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData(['me'], null);
      qc.clear();
    },
  });
}
