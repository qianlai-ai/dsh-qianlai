// 来源：moneycome harness/test/unit/arch/no-domain-constants.spec.ts @ f9f469d7（分支 feat/fintax-scheme-sample，2026-08-17 快照）
// 本文件是四个搬来的 spec 里唯一改了断言结构的：扫描范围从六到八个目录扩到 src/ 全量，
// prisma schema 的两条断言删掉（本包没有 schema.prisma，落库不在本包），
// __dirname 换成 import.meta.dirname（ESM），另加一段豁免登记的活性检查。逐条见 A6-SNAPSHOT.md。

/**
 * A1 零领域常量扫描（`docs/modules/fintax-accounting-slice-v1.md` §7）。
 *
 * 确保 L1 会计事实层与 L3 通用引擎不含领域知识：税种名、科目号、科目名、
 * 地区名、纳税人类型、税率数字一律在 L2 领域规则包里。
 *
 * **扫描只针对代码本体，注释被剥掉**——写「这里不许出现科目号」的说明性注释是
 * 合法的，把 6001 写进字段默认值不是。
 *
 * 这属于「读 source 文件查行为边界的扫描」，是 `AGENTS.md` 明确鼓励的类型，
 * 与被禁的 doc-prose 冻结测试不同。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PKG_ROOT = join(import.meta.dirname, '..', '..');

/** 文件读写保留原生路径；扫描名单比较统一使用包内的正斜杠相对路径。 */
function packageRelativePath(file: string): string {
  return relative(PKG_ROOT, file).split(sep).join('/');
}

/**
 * 扫描范围：`src/` 全量。
 *
 * moneycome 那边是一张手写目录清单（八项），新建目录忘了加就落在墙外——它自己的
 * 注释记了一次教训：2026-08-16 把两张领域映射表写进 `scripts/` 下的灌库器，正好在
 * 清单之外，靠 owner 追问才发现。本包只有一个源码根，直接扫全量，没有「忘了加」
 * 这条路。
 */
const SCANNED_SRC_DIRS = ['src'];

/**
 * 扫描范围内的例外，逐个写理由。**只许放「给识别器/模型看的材料描述与话术」，
 * 不许放判断。**
 *
 * - `material-intake-turn.ts`：员工技能文本（「你是钱来的财税助手，服务一家小规模
 *   纳税人企业」「工资、社保、个税、增值税这类一天多条」）。moneycome 的同名豁免
 *   原样带过来。
 *
 *   **这是权宜，不是它该待的地方**：persona 与 squad playbook 不该硬编码进领域核，
 *   技能文本的正主是会计包或员工实体自己的 system。在本项目里它的去处是 agent 那侧
 *   的插件，不是 `fintax-core`——搬进来只因为它 import 干净。等它搬走，本条删。
 *
 * - `book-read.contract.ts`：2026-10-23 换基线到 moneycome `422cbfe30` 后，两条给模型看的
 *   字段说明（提交时间、材料最近更新时间）写着「按 Asia/Shanghai（北京时间）换算」，命中
 *   地区名。它们是描述文字，不是判断；但时区本该来自企业辖区，不该写死在通用合同里，
 *   这是 moneycome 侧的耦合，要回流成 moneycome 的 issue。修掉后本条删。
 */
const EXCLUDED_FILES: ReadonlySet<string> = new Set([
  'src/finance-intake/material-intake-turn.ts',
  'src/finance-read/book-read.contract.ts',
]);

/**
 * 豁免登记：扫描器**照不出**、但确实是领域常量的地方。
 *
 * 总方案 §2.2 点名了 `invoice-self-checks.ts` 的两组。实测下来它们根本不触发上面
 * 任何一条规则——`new Set([8, 20])` 里既没有税种名也没有科目号，六条正则一条都不沾。
 * 也就是说这类「位数集合 / 长度集合」形态的领域知识，A1 现有的词表照不到，靠的是
 * 文件头自己认账。把它登记在这里，并检查符号还在，是为了：债还掉那天这条会失败，
 * 逼人回来删；债没还时它至少在测试里看得见，而不是只躺在一条注释里。
 *
 * 处置选的是「显式豁免登记」而不是「迁进包」：本包是纯函数库，没有规则包结构，
 * 会计包是外部数据（由 `accounting-pack.contract` 校验），迁进去要先有 L2 的形状规则段。
 * 那是以后的事。
 */
const DECLARED_EXEMPTIONS: readonly {
  readonly file: string;
  readonly symbol: string;
  readonly reason: string;
}[] = [
  {
    file: 'src/finance-intake/invoice-self-checks.ts',
    symbol: 'INVOICE_NUMBER_LENGTHS',
    reason:
      '发票号码位数（全电 20 位、旧版 8 位）写死在校验算法里。正主是会计包的形状规则段；moneycome 文件头已自认为债。',
  },
  {
    file: 'src/finance-intake/invoice-self-checks.ts',
    symbol: 'TAX_ID_LENGTHS',
    reason:
      '纳税人识别号位数（15 / 17 / 18 / 20）同上。两支合流时应改为从包读。',
  },
];

interface ForbiddenPattern {
  readonly label: string;
  readonly pattern: RegExp;
}

const FORBIDDEN: readonly ForbiddenPattern[] = [
  {
    label: '税种名',
    pattern:
      /增值税|企业所得税|个人所得税|印花税|附加税|城市维护建设税|教育费附加/,
  },
  {
    label: '科目名',
    pattern:
      /主营业务收入|银行存款|应交税费|管理费用|应收账款|应付账款|其他应付款|其他应收款|实收资本|未分配利润|货币资金|营业费用|商品销售收入|库存商品/,
  },
  {
    label: '纳税人类型',
    pattern: /小规模纳税人|一般纳税人/,
  },
  {
    label: '地区名',
    pattern: /浙江|杭州|江苏|山东|广东|福建|北京|上海|深圳|zhejiang|hangzhou/i,
  },
  {
    // 四位科目号只在字符串字面量里禁——行号、长度上限之类的裸数字不算。
    label: '科目号字面量',
    pattern: /['"`][1-6]\d{3}['"`]/,
  },
  {
    label: '税率字面量',
    pattern:
      /['"`]\s*(?:1|3|5|6|9|13)\s*%\s*['"`]|\b0\.(?:01|03|05|06|09|13)\b/,
  },
];

/** 剥掉 `//` 行注释与块注释。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function collectTsFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}

function findViolations(
  label: string,
  source: string,
): { rule: string; line: number; text: string }[] {
  const stripped = stripComments(source);
  const hits: { rule: string; line: number; text: string }[] = [];
  stripped.split('\n').forEach((line, index) => {
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(line)) {
        hits.push({
          rule: `${label} · ${rule.label}`,
          line: index + 1,
          text: line.trim().slice(0, 160),
        });
      }
    }
  });
  return hits;
}

describe('A1 · L3 通用引擎零领域常量', () => {
  it('中文和空格目录也能得到统一的包内相对路径', () => {
    expect(
      packageRelativePath(join(PKG_ROOT, 'src', '中文 目录', 'probe.ts')),
    ).toBe('src/中文 目录/probe.ts');
  });

  it.each(SCANNED_SRC_DIRS)('%s 全量不含任何领域常量', (relativeDir) => {
    const files = collectTsFiles(join(PKG_ROOT, relativeDir)).filter(
      (file) => !EXCLUDED_FILES.has(packageRelativePath(file)),
    );
    const violations = files.flatMap((file) =>
      findViolations(packageRelativePath(file), readFileSync(file, 'utf8')),
    );
    expect(violations).toEqual([]);
  });

  it('扫描范围不是空的——搬来的领域核确实在里面', () => {
    const files = collectTsFiles(join(PKG_ROOT, 'src')).map((file) =>
      packageRelativePath(file),
    );
    for (const expected of [
      'src/finance-ledger/ledger-posting.engine.ts',
      'src/finance-period/closing-checks.ts',
      'src/finance-intake/invoice-self-checks.ts',
      'src/finance-onboarding/opening-balance.contract.ts',
      'src/message-channel/message-channel.registry.ts',
    ]) {
      expect(files).toContain(expected);
    }
  });
});

describe('A1 · 豁免登记仍然指向真东西', () => {
  it.each(DECLARED_EXEMPTIONS.map((entry) => [entry.symbol, entry] as const))(
    '%s 还在源码里——债没还，登记不许先删',
    (_symbol, entry) => {
      const source = readFileSync(join(PKG_ROOT, entry.file), 'utf8');
      expect(source).toContain(entry.symbol);
      expect(entry.reason.length).toBeGreaterThan(20);
    },
  );

  it('被豁免的文件确实在扫描范围内，只是被显式放行', () => {
    const files = collectTsFiles(join(PKG_ROOT, 'src')).map((file) =>
      packageRelativePath(file),
    );
    for (const excluded of EXCLUDED_FILES) {
      expect(files).toContain(excluded);
    }
  });
});

describe('A1 · 扫描器自身可信', () => {
  // 一个永远返回空的扫描器也能让上面全绿。这里证明它真的会抓。
  it.each([
    ['科目名', 'const subject = "银行存款";'],
    ['科目号字面量', 'const code = "6001";'],
    ['税种名', 'if (kind === "增值税") return;'],
    ['纳税人类型', 'const t = "小规模纳税人";'],
    ['地区名', 'const region = "浙江";'],
    ['税率字面量', 'const rate = 0.01;'],
  ])('会抓到 %s', (_label, snippet) => {
    expect(findViolations('probe', snippet)).not.toEqual([]);
  });

  it('注释里的说明性文字不算违规', () => {
    const commentary = [
      '// L1 表里不得出现科目号、科目名、增值税这类领域常量。',
      '/* 科目映射（如 主营业务收入）一律进 L2 领域规则包。 */',
      'const explanationState = "unexplained";',
    ].join('\n');
    expect(findViolations('probe', commentary)).toEqual([]);
  });

  it('字段名 subjectCode / subjectName 本身不算违规', () => {
    // 分录必须自带科目，否则报表无从生成；那是运行时从包查出的数据行，
    // 不是 schema 字面量。
    const line = '  subjectCode  String\n  subjectName  String';
    expect(findViolations('probe', line)).toEqual([]);
  });

  it('位数集合这类领域常量照不出来——所以才要豁免登记', () => {
    // 这条是本包新加的负面证据，不是从 moneycome 搬的。它钉住一个事实：
    // A1 的词表管不住 `new Set([8, 20])` 形态的领域知识。谁要是哪天给 FORBIDDEN
    // 加了能抓它的规则，这条会失败——那正是回来把 DECLARED_EXEMPTIONS 清掉的时机。
    const snippet = 'const INVOICE_NUMBER_LENGTHS = new Set([8, 20]);';
    expect(findViolations('probe', snippet)).toEqual([]);
  });
});
