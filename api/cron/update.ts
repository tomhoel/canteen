import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runWeeklyUpdateService } from '../../src/server/services/menu.service';
import { processAllCanteenAIImages } from '../../src/server/services/image.service';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify authorization header if CRON_SECRET is configured
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized cron trigger' });
  }

  console.log('🚀 [Vercel Cron] Starting automated weekly menu scraping & AI processing...');

  try {
    const record = await runWeeklyUpdateService();
    console.log(`✅ Menu scraped & persisted for week: ${record.weekId}`);

    // Process main dish AI image generation & transparent background removal
    try {
      await processAllCanteenAIImages(record.menuData);
      console.log('✅ AI dish images processed & archived');
    } catch (imgErr: any) {
      console.warn('⚠️ Image processing completed with warning:', imgErr.message);
    }

    return res.status(200).json({
      status: 'success',
      weekId: record.weekId,
      dishesExtracted: Object.keys(record.dishOrigins || {}).length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('❌ Vercel Cron execution failed:', error);
    return res.status(500).json({
      error: 'Cron execution failed',
      details: error.message,
    });
  }
}
