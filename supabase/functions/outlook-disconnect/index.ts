import { handleOutlook } from '../_shared/outlook-runtime.ts';

Deno.serve(request => handleOutlook('disconnect', request));
