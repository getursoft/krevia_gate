import type { Society } from '@prisma/client';
import type { SocietyDetailDto, SocietySummaryDto } from '@krevia/shared';

export const toSocietySummary = (s: Society): SocietySummaryDto => ({
  id: s.id,
  name: s.name,
  addressLine: s.addressLine,
  city: s.city,
  state: s.state,
  pincode: s.pincode,
});

export const toSocietyDetail = (s: Society): SocietyDetailDto => ({ ...toSocietySummary(s), towers: s.towers });
