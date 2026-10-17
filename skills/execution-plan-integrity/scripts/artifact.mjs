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
  'SKILL.md': '98b7008dbd38d36be24f311defba5914bc5ec7ade5ec491284005e898cc540f3',
  'agents/openai.yaml': 'd9322ee1351bdce6770eb1994f18a8bb485fc97abdd0bc56e356acc44c3c93cb',
  'references/contract.md': '4019b39dcce61ee5d6eb59ef3da7eb21a71fc33e4409e8c4b4565ea1ee37f46e',
  'references/migration.md': '7f2eef4cb63f1906c4e3bbdff74fb646de288d715cd446d4b67be875fba44fc6',
  'references/report-template.md': 'ead9b414a89777e9add4cf38b99ea23a24541b8edbf29b657eeb2f8cd10f7d66',
  'references/completion-proof.md': 'bb4af9fbfbf3636f545166c36d79f705349e2c27f25c790acfcdd494a10ab238',
  'assets/checker/check-execution-plan.mjs': '6ff5f0ea38639f62ed272d3d5371c756c9bc55aa5c16f200430212af42ece262',
  'assets/checker/completion-proof.mjs': 'd0d6e6b2001390d5b83ba34fbe94843a7bacbe43be8b6b8060f56a47c76ab4b9',
  'assets/checker/execution-register.mjs': 'd02240a65314dda97f57034c8f5e3ac63fc31923b9e5f14ad33d3cc8c860c659',
  'assets/checker/execution-register.test.mjs': 'c946b33eb87e82d2395f01900d8ce1e597b59c202e10e48d2822beab78eb1557',
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
