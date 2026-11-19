// Registers @testing-library/jest-dom matchers on the SAME vitest instance as the test files.
// '@testing-library/jest-dom/vitest' imports 'vitest' itself and, when the shell cwd has a
// lowercase drive letter (Git Bash on Windows), extends a different vitest copy
// ("Invalid Chai property: toHaveAttribute"). The matchers entry does not import vitest,
// so extending the aliased `expect` here works from every shell.
import type {} from '@testing-library/jest-dom/vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { expect } from 'vitest'

expect.extend(matchers)
