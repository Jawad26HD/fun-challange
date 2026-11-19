import { handleOutlook } from '../_shared/outlook-runtime.ts';

Deno.serve(request => handleOutlook('status', request));
