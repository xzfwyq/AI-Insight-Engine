// @ts-check
/**
 * 词典情感分析(替代 AI 自由判断)
 *
 * 设计动机:
 * Map 阶段 AI 自由判断 sentiment 有明显问题 —
 * "全网骂 Claude 变笨"被判中性,AI 把"揭秘/澄清"框架当中性,没识别"骂/变笨"的负面倾向。
 * 词典法更严谨:可复现(同输入同输出)、可审计(追溯到具体词)、可测试(单测覆盖)、不依赖 AI。
 *
 * 算法:
 * 1. 子串匹配(中英文通用,无需分词)
 * 2. 否定词反转:命中词前 4 字符内有否定词 → 极性反转("不认可" → 负面)
 * 3. 程度副词加权:命中词前 4 字符内有程度副词 → 权重 ×1.5("非常优秀" → 1.5)
 * 4. 归一化:score = (pos - neg) / max(pos + neg, 1),范围 [-1, 1]
 * 5. 阈值:score > 0.15 → positive, < -0.15 → negative, else neutral
 *
 * 可解释性:输出 posHits/negHits,可追溯每个判断到具体词
 */

export const SENTIMENT_LEXICON = {
  positive: [
    // 中文
    '突破', '创新', '增长', '上涨', '攀升', '走高', '新高', '破纪录', '创纪录', '刷新',
    '获奖', '成功', '上线', '发布', '合作', '融资', '好评', '领先', '超越', '提升',
    '进步', '支持', '认可', '里程碑', '重磅', '首发', '强劲', '繁荣', '利好', '夺冠',
    '登顶', '爆款', '热销', '赞誉', '推荐', '优秀', '出色', '卓越', '杰出', '一流',
    '顶尖', '完善', '成熟', '普及', '流行', '热潮', '火热', '青睐', '看好', '押注',
    '加码', '重仓', '赋能', '助推', '驱动', '加速', '蓬勃发展',
    // 英文
    'good', 'great', 'excellent', 'breakthrough', 'innovation', 'growth', 'award',
    'success', 'launch', 'partnership', 'funding', 'praise', 'leading', 'improve',
    'optimize', 'support', 'acclaim', 'milestone', 'premium', 'outstanding', 'superb',
    'stellar', 'robust', 'thriving', 'win', 'champion', 'top', 'popular', 'embrace',
    'favor', 'rise', 'surge', 'soar', 'record', 'high', 'boost', 'advance',
  ],
  negative: [
    // 中文(单字负面词只留歧义小的,如"差"会误命中"差异"故不用)
    '烂', '骂', '变笨', '起诉', '诉讼', '违规', '泄露', '下架', '失败',
    '质疑', '下降', '裁员', '倒闭', '事故', '崩溃', '争议', '纠纷', '侵权', '抄袭',
    '败诉', '亏损', '下滑', '暴跌', '警告', '处罚', '罚没', '约谈', '立案', '调查',
    '信任危机', '吐槽', '翻车', '暴雷', '跑路', '欺诈', '造假', '虚假', '违法', '退市',
    '破产', '变差', '变弱', '缩水', '瓶颈', '困境', '风险', '危机', '故障', '漏洞',
    '缺陷', '下跌', '走低', '重挫', '受挫', '受困', '承压', '恶化', '波及', '波折',
    // 英文
    'bad', 'worst', 'sue', 'lawsuit', 'violation', 'leak', 'fail', 'decline', 'layoff',
    'bankrupt', 'bug', 'crash', 'controversy', 'dispute', 'infringement', 'copy', 'loss',
    'down', 'fall', 'drop', 'plunge', 'warn', 'penalty', 'fine', 'investigate', 'scandal',
    'fraud', 'fake', 'illegal', 'delist', 'bankruptcy', 'crisis', 'risk', 'threat', 'weak',
    'poor', 'disappoint', 'frustrate', 'collapse', 'corruption', 'breach',
  ],
  // 否定词(命中词前 4 字符内出现则反转极性)
  // 注意:不用"非"(会被"非常"误命中),保留更明确的单字
  negation: ['不', '没', '未', '无', '勿', '别', '莫', 'not', 'no', 'never', 'without', "don't", "doesn't", "isn't", "aren't", "won't"],
  // 程度副词(命中词前 4 字符内出现则权重 ×1.5)
  degree: ['很', '非常', '极其', '太', '超', '十分', '相当', '特别', '尤其', '格外', '极度', '更', 'very', 'extremely', 'too', 'super', 'highly', 'quite'],
};

/**
 * 词典情感打分
 * @param {string} text - 待分析文本(title + summary)
 * @returns {{direction: string, score: number, posHits: Array, negHits: Array, method: string}}
 */
export function computeLexiconSentiment(text) {
  if (!text || typeof text !== 'string') {
    return { direction: 'neutral', score: 0, posHits: [], negHits: [], method: 'lexicon' };
  }

  const lower = text.toLowerCase();
  let posScore = 0;
  let negScore = 0;
  const posHits = [];
  const negHits = [];

  function scanWord(word, isPositive) {
    const wl = word.toLowerCase();
    const isEnglish = /^[a-z]/.test(wl);
    let idx = lower.indexOf(wl);
    while (idx !== -1) {
      // 英文词做词边界检查(避免 "top" 命中 "prototype")
      // 允许后缀变形(-s/-es/-ed/-ing),如 sue → sues/sued/suing
      if (isEnglish) {
        const before = idx > 0 ? lower[idx - 1] : ' ';
        const rest = lower.slice(idx + wl.length);
        if (/[a-z]/.test(before)) {
          idx = lower.indexOf(wl, idx + wl.length);
          continue;
        }
        // 后缀必须是空/标点/非字母,或常见动词变形
        const suffixMatch = rest.match(/^(s|es|ed|ing|d)\b/);
        if (rest.length > 0 && !suffixMatch && /^[a-z]/.test(rest)) {
          idx = lower.indexOf(wl, idx + wl.length);
          continue;
        }
      }
      // 命中词前 4 字符内的上下文,用于检测否定/程度
      const prefix = lower.slice(Math.max(0, idx - 4), idx);
      const negated = SENTIMENT_LEXICON.negation.some((n) => prefix.includes(n.toLowerCase()));
      const hasDegree = SENTIMENT_LEXICON.degree.some((d) => prefix.includes(d.toLowerCase()));
      const weight = hasDegree ? 1.5 : 1;

      if (negated) {
        if (isPositive) {
          negScore += weight;
          negHits.push({ word, negated: true, context: prefix });
        } else {
          posScore += weight;
          posHits.push({ word, negated: true, context: prefix });
        }
      } else {
        if (isPositive) {
          posScore += weight;
          posHits.push({ word, degree: hasDegree });
        } else {
          negScore += weight;
          negHits.push({ word, degree: hasDegree });
        }
      }
      idx = lower.indexOf(wl, idx + wl.length);
    }
  }

  SENTIMENT_LEXICON.positive.forEach((w) => scanWord(w, true));
  SENTIMENT_LEXICON.negative.forEach((w) => scanWord(w, false));

  const total = posScore + negScore;
  const score = total === 0 ? 0 : (posScore - negScore) / Math.max(total, 1);

  let direction;
  if (score > 0.15) direction = 'positive';
  else if (score < -0.15) direction = 'negative';
  else direction = 'neutral';

  return {
    direction,
    score: Number(score.toFixed(3)),
    posHits,
    negHits,
    method: 'lexicon',
  };
}

export default SENTIMENT_LEXICON;
