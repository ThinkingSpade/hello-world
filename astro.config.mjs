import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 👉 CHANGE THIS to your real domain. It's used for canonical URLs,
//    Open Graph tags, and the generated sitemap. (Currently your Pages URL.)
const SITE = 'https://hello-world-bp7.pages.dev';

export default defineConfig({
  site: SITE,
  // keep the existing URL shape: index.html / work.html / about.html
  build: { format: 'file' },
  integrations: [sitemap()],
});
