// فحص/إصلاح HTML قبل المعاينة — يمنع الصفحات البيضاء الناتجة عن وسوم مكسورة
export interface RepairResult {
  html: string;
  repairs: string[];
  fatal: string[]; // مشاكل لم تُصلح
}

export function repairHtml(input: string): RepairResult {
  let html = String(input ?? '');
  const repairs: string[] = [];
  const fatal: string[] = [];

  // 1) <title> غير مغلق وينتهي بـ </meta> (خطأ شائع من النماذج)
  const badTitle = /<title>([\s\S]*?)<\/meta>/i;
  if (badTitle.test(html)) {
    html = html.replace(badTitle, (_m, inner) => `<title>${inner}</title>`);
    repairs.push('أُغلق وسم <title> (كان </meta>)');
  }

  // 2) </meta> شارد بلا <meta ...> مقابل
  const metaOpens = (html.match(/<meta\b/gi) ?? []).length;
  const metaCloses = (html.match(/<\/meta>/gi) ?? []).length;
  if (metaCloses > 0 && metaCloses > metaOpens) {
    html = html.replace(/<\/meta>/gi, '');
    repairs.push('حُذف </meta> شارد');
  }

  // 3) title مفتوح بلا إغلاق (قبل style/body)
  if (/<title>/i.test(html) && !/<\/title>/i.test(html)) {
    html = html.replace(/<title>([\s\S]*?)(?=<style|<body|<\/head)/i, '<title>$1</title>');
    repairs.push('أُغلق <title> قبل المحتوى');
  }

  // 4) style/script غير مغلقين — أغلق في المكان الصحيح
  for (const tag of ['style', 'script']) {
    let opens = (html.match(new RegExp(`<${tag}\\b`, 'gi')) ?? []).length;
    let closes = (html.match(new RegExp(`</${tag}>`, 'gi')) ?? []).length;
    while (opens > closes) {
      if (tag === 'style' && /<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `</${tag}></head>`);
      else if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `</${tag}></body>`);
      else html += `</${tag}>`;
      repairs.push(`أُغلق <${tag}> المفقود`);
      closes++;
    }
  }

  // 5) إغلاق المستند (فقط إذا كانت الوسوم موجودة)
  if (/<body[\s>]/i.test(html) && !/<\/body>/i.test(html)) {
    html = /<\/html>/i.test(html) ? html.replace(/<\/html>/i, '</body></html>') : html + '</body>';
    repairs.push('أُضيف </body>');
  }
  if (/<html[\s>]/i.test(html) && !/<\/html>/i.test(html)) {
    html += '</html>';
    repairs.push('أُضيف </html>');
  }

  // 6) فحص بنيوي أخير
  if (!/<body[\s>]/i.test(html)) fatal.push('لا يوجد <body>');
  if (/<title>[^<]*<style/i.test(html)) fatal.push('<title> ما زال يبتلع المحتوى');

  return { html, repairs, fatal };
}
