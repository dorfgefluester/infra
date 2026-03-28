const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs } = require('./cli-args.cjs');
const { writeJson, writeText } = require('./fs-utils.cjs');
const {
  CHECKLIST_SECTIONS,
  QUALITY_SCORE_VALUES,
  REVIEW_OUTCOME_VALUES,
  REVIEW_STATUS_VALUES,
  SKILL_FILES,
  flattenChecklistItems,
  getRepoRoot,
} = require('./pr-review-config.cjs');

function readSkillContents(repoRoot) {
  return SKILL_FILES.map((relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    return {
      path: relativePath,
      content: fs.readFileSync(absolutePath, 'utf8').trim(),
    };
  });
}

function renderChecklistReference() {
  return CHECKLIST_SECTIONS.map((section) => {
    const lines = [`## ${section.title}`];
    for (const item of section.items) {
      lines.push(`- \`${item.id}\`: ${item.label}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

function renderSkillAppendix(repoRoot) {
  return readSkillContents(repoRoot).map((skill) => {
    return [`## ${skill.path}`, '```md', skill.content, '```'].join('\n');
  }).join('\n\n');
}

function gitDiff(args) {
  return execFileSync(
    'git',
    ['--no-pager', 'diff', '--unified=5', args.baseSha, args.headSha],
    { cwd: args.repoRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );
}

function gitNameStatus(args) {
  return execFileSync(
    'git',
    ['--no-pager', 'diff', '--name-status', args.baseSha, args.headSha],
    { cwd: args.repoRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }
  );
}

function gitDiffStat(args) {
  return execFileSync(
    'git',
    ['--no-pager', 'diff', '--stat=200', args.baseSha, args.headSha],
    { cwd: args.repoRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }
  );
}

function createReviewSchema() {
  const checklistProperties = {};
  const requiredChecklistItems = [];

  for (const item of flattenChecklistItems()) {
    checklistProperties[item.id] = { $ref: '#/$defs/checkItem' };
    requiredChecklistItems.push(item.id);
  }

  return {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', maxLength: 80 },
            body: { type: 'string', minLength: 1 },
            confidence_score: { type: 'number', minimum: 0, maximum: 1 },
            priority: { type: 'integer', minimum: 0, maximum: 3 },
            code_location: {
              type: 'object',
              properties: {
                path: { type: 'string', minLength: 1 },
                line_range: {
                  type: 'object',
                  properties: {
                    start: { type: 'integer', minimum: 1 },
                    end: { type: 'integer', minimum: 1 },
                  },
                  required: ['start', 'end'],
                  additionalProperties: false,
                },
              },
              required: ['path', 'line_range'],
              additionalProperties: false,
            },
          },
          required: ['title', 'body', 'confidence_score', 'priority', 'code_location'],
          additionalProperties: false,
        },
      },
      checklist: {
        type: 'object',
        properties: checklistProperties,
        required: requiredChecklistItems,
        additionalProperties: false,
      },
      review_outcome: {
        type: 'string',
        enum: REVIEW_OUTCOME_VALUES,
      },
      quality_score: {
        type: 'string',
        enum: QUALITY_SCORE_VALUES,
      },
      top_issues: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 180,
        },
        minItems: 3,
        maxItems: 3,
      },
      overall_correctness: {
        type: 'string',
        enum: ['patch is correct', 'patch is incorrect'],
      },
      overall_explanation: {
        type: 'string',
        minLength: 1,
      },
      overall_confidence_score: {
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
    },
    required: [
      'findings',
      'checklist',
      'review_outcome',
      'quality_score',
      'top_issues',
      'overall_correctness',
      'overall_explanation',
      'overall_confidence_score',
    ],
    additionalProperties: false,
    $defs: {
      checkItem: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: REVIEW_STATUS_VALUES,
          },
          rationale: {
            type: 'string',
            minLength: 1,
            maxLength: 240,
          },
        },
        required: ['status', 'rationale'],
        additionalProperties: false,
      },
    },
  };
}

function buildPrompt(args) {
  const basePrompt = fs.readFileSync(args.promptTemplate, 'utf8').trim();
  const checklistReference = renderChecklistReference();
  const skillAppendix = renderSkillAppendix(args.repoRoot);

  return [
    basePrompt,
    '',
    'You must evaluate the PR against the shared review skills and the required checklist below.',
    'For every checklist item, set exactly one status:',
    '- `completed`: repo evidence supports the requirement',
    '- `needs_attention`: the PR is missing evidence, has a risk, or introduces a problem',
    '- `not_applicable`: the item genuinely does not apply to the changed scope',
    '',
    'Repository:',
    `- ${args.repository}`,
    `Pull Request #: ${args.prNumber}`,
    `Base ref: ${args.baseRef}`,
    `Head ref: ${args.headRef}`,
    `Base SHA: ${args.baseSha}`,
    `Head SHA: ${args.headSha}`,
    '',
    '# Required Review Checklist',
    checklistReference,
    '',
    '# Review Skills',
    skillAppendix,
    '',
    '# Git Diff Metadata',
    'Changed files:',
    gitNameStatus(args).trim(),
    '',
    'Diff stat:',
    gitDiffStat(args).trim(),
    '',
    'Unified diff (context=5):',
    gitDiff(args).trim(),
    '',
    'Return JSON only and follow the provided schema exactly.',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const { args } = parseArgs(argv);
  const repoRoot = args['repo-root'] ? path.resolve(String(args['repo-root'])) : getRepoRoot();
  const promptTemplate = path.resolve(
    repoRoot,
    String(args['prompt-template'] || '.github/codex/review-prompt.md')
  );
  const outputPrompt = path.resolve(
    repoRoot,
    String(args['output-prompt'] || 'codex-prompt.md')
  );
  const outputSchema = path.resolve(
    repoRoot,
    String(args['output-schema'] || 'codex-output-schema.json')
  );

  const requiredKeys = ['base-sha', 'head-sha', 'repository', 'pr-number', 'base-ref', 'head-ref'];
  for (const key of requiredKeys) {
    if (!args[key]) {
      throw new Error(`Missing required --${key} argument.`);
    }
  }

  const prompt = buildPrompt({
    repoRoot,
    promptTemplate,
    baseSha: String(args['base-sha']),
    headSha: String(args['head-sha']),
    repository: String(args.repository),
    prNumber: String(args['pr-number']),
    baseRef: String(args['base-ref']),
    headRef: String(args['head-ref']),
  });

  writeText(outputPrompt, prompt + '\n');
  writeJson(outputSchema, createReviewSchema());
}

if (require.main === module) {
  main();
}

module.exports = {
  buildPrompt,
  createReviewSchema,
  main,
  readSkillContents,
  renderChecklistReference,
};
