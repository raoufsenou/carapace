export const SKILL_NAME = 'execution-plan-integrity'

export const ARTIFACT_ENTRIES = Object.freeze([
  'SKILL.md',
  'agents/openai.yaml',
  'references/contract.md',
  'references/migration.md',
  'references/report-template.md',
  'references/completion-proof.md',
  'assets/checker/check-execution-plan.mjs',
  'assets/checker/completion-proof.mjs',
  'assets/checker/execution-register.mjs',
  'assets/checker/execution-register.test.mjs',
])

export const REQUIRED_ARTIFACT_FILES = ARTIFACT_ENTRIES

export const ARTIFACT_SHA256 = Object.freeze({
  'SKILL.md': '5422a2ba6506ceef1688d552bca8bff062ab4a03d35ace9bde94930e79984c42',
  'agents/openai.yaml': 'd9322ee1351bdce6770eb1994f18a8bb485fc97abdd0bc56e356acc44c3c93cb',
  'references/contract.md': 'd07250056d55df8f10997f1ea6feedff4030d5aaa9253eb19ed18088b31ba3d7',
  'references/migration.md': 'c65261aead6a0073e3f025ceea760af68a5772142dd616e29a2fb1ce97168d7a',
  'references/report-template.md': 'ead9b414a89777e9add4cf38b99ea23a24541b8edbf29b657eeb2f8cd10f7d66',
  'references/completion-proof.md': 'a522c0d2d146cde08e776f7e26a0233be5f5cb36d7094363a576c24ab74e027b',
  'assets/checker/check-execution-plan.mjs': '7ab499732274f0ca16421492a86f9cd35be54cf20e0800e0ed1f29f924bf73a2',
  'assets/checker/completion-proof.mjs': '838eb022eb02f87e765c93e07bcdce8d2301a3beab32bdbdef0bb5200f01716e',
  'assets/checker/execution-register.mjs': '8137c25dd173410701a1fe180a07ece1f9ad606c148d0ef851f9c2d65aae8d22',
  'assets/checker/execution-register.test.mjs': 'f2d8265c3e3a051c635f149f4b5b7aa3b8340487f00ff09aa49e3a9c36e16ff4',
})

export const SKILL_VERIFICATION_PROOFS = Object.freeze([
  'exactly one plan-like document has role `canonical`;',
  'every discovered plan-like document has exactly one configured role;',
  'noncanonical documents contain no execution-register markers;',
  'the canonical register has exactly one bounded block;',
  'every stable ID is unique and uses the contract syntax;',
  'the pointer names the single `NOW` row, is `IDLE` only with tracked unresolved work plus a reason and',
  'ordered task numbers are contiguous and the first unfinished task is `NOW`;',
  'a batch is a `VALIDATION` row naming exactly the members after it, none of them `NOW` or a batch, and',
  'every task declares its kind and every `DONE` task has a matching v2 closure proof;',
  'every proof enumerates requirements, repository evidence and meaningful verification, reports no',
  'every proof of a member of the current batch preserves the member\'s row and passes, except against a',
  'implementation-like proofs contain an exact file ledger, reachable integration trace and',
  'non-implementation completions track implementation successors by stable ID or cite the recorded',
  'every `DEFERRED` task has a trigger and every active task has a source or acceptance boundary;',
  'forbidden live-sequencing headings in noncanonical documents fail the checker;',
  'the register holds only the pointer, `IDLE` fields, and task-table rows;',
  'the canonical document stays within the contract\'s word limit;',
  'each fact has one home: the current step only in the `NOW` row, each decision in force in one current',
  'the repository instruction from apply step 7 is in place and instruction files hold no execution',
  'the global mutation suite passes and the global checker accepts the target\'s standard config.',
])

export const REPORT_VERIFICATION_PROOFS = Object.freeze([
  'Exactly one canonical document',
  'Every plan-like document has exactly one role',
  'Pointer names one `NOW` row, a justified `IDLE` state, or a valid terminal `NONE` state',
  '`IDLE` reason and resume condition name tracked unresolved work',
  'IDs are unique and ordered positions are contiguous',
  'First unfinished ordered task is `NOW`',
  'A batch names exactly the members after it, and only its members finish out of order',
  'Noncanonical register and sequencing are rejected',
  'Required evidence, source, owner, and trigger cells are present',
  'Every task declares an outcome kind',
  'Every `DONE` row has a matching semantic closure proof',
  'Batch member proofs preserve their rows, and every row a closing proof preserves has a matching proof',
  'Every requirement has repository evidence and meaningful verification',
  'Implementation proofs contain ledger, reachability and falsification',
  'Non-implementation completion has an explicit implementation disposition',
  'No closure proof contains an unverified acceptance item',
  'Terminal `NONE` is rejected while ordered work, unordered work, or untracked selected delivery remains',
  'Register holds only the pointer, `IDLE` fields, and task-table rows',
  'Canonical document stays within the word limit',
  'Each fact has one home',
  'Repository instruction is in place and instruction files hold no execution state',
  'Skill-owned mutation suite passes and checker accepts the target config',
])
