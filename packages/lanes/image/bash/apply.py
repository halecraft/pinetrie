#!/usr/bin/env python3
# pine·trie's patch to GNU bash, applied as edits at anchors rather than as
# a diff: every bash from 5.0 to 5.3 has each anchor, whatever the lines
# around it, and each must match exactly once, so a bash that moved one
# fails the image's build here, naming it, rather than building a shell that
# never signals.
#
# The patch makes `bash -c` tell the kernel, by a prctl no kernel
# implements, as each top-level statement of its string starts: the
# statement's ordinal and line. pine·trie's observer takes it from the shell
# alone, and tags all that statement's processes write
# (packages/lanehost/TECHNICAL.md).
#
# GNU bash is free software under the GNU General Public License, version 3
# or later (https://www.gnu.org/licenses/gpl-3.0.html), from
# https://ftp.gnu.org/gnu/bash/; this patch to it is under the same licence.
#   apply.py <bash source directory>
import re, sys

root = sys.argv[1]

def edit(path, pattern, replace):
    p = f'{root}/{path}'
    s = open(p).read()
    found = list(re.finditer(pattern, s, re.M))
    if len(found) != 1:
        sys.exit(f'{path}: {len(found)} matches for {pattern!r}')
    open(p, 'w').write(s[:found[0].start()] + replace(found[0]) + s[found[0].end():])

# A free flag bit: every version's flags stop below 0x10000.
edit('command.h', r'^(#define CMD_STDPATH.*\n(?:#define CMD_TRY_OPTIMIZING.*\n)?)',
     lambda m: m[1] + '#define CMD_PT_TOP\t    0x10000\t/* pine·trie: a top-level statement of -c, not yet started */\n')

edit('execute_cmd.h', r'^(extern int execute_command .*\n)',
     lambda m: m[1] + 'extern void pt_mark_statements (COMMAND *);\n')

HOOKS = r'''
/* pine·trie: each top-level statement of `bash -c` tells the kernel, by a
   prctl no kernel implements, that it starts: its ordinal among the
   string's top-level statements, and its line. Sent at execute_command_
   internal's entry, before the statement's redirections and before any
   fork, so all it does inherits the tag. The mark is cleared as it is sent,
   so a child forked from the statement never sends it again. */
#include <sys/prctl.h>
#define PT_PRCTL 0x50540001
static int pt_ordinal;

void
pt_mark_statements (COMMAND *command)
{
  if (command == 0)
    return;
  if (command->type == cm_connection &&
      (command->value.Connection->connector == ';' ||
       command->value.Connection->connector == '&' ||
       command->value.Connection->connector == '\n'))
    {
      pt_mark_statements (command->value.Connection->first);
      pt_mark_statements (command->value.Connection->second);
    }
  else
    command->flags |= CMD_PT_TOP;
}

/* The line a command starts on. struct command's own `line' is not set by
   make_command, so it is read from each type's own struct, or from the
   first command inside one that keeps none. */
static int
pt_line (COMMAND *command)
{
  int depth;

  for (depth = 0; command && depth < 64; depth++)
    switch (command->type)
      {
      case cm_simple: return command->value.Simple->line;
      case cm_for: return command->value.For->line;
      case cm_case: return command->value.Case->line;
#if defined (SELECT_COMMAND)
      case cm_select: return command->value.Select->line;
#endif
#if defined (DPAREN_ARITHMETIC)
      case cm_arith: return command->value.Arith->line;
#endif
#if defined (COND_COMMAND)
      case cm_cond: return command->value.Cond->line;
#endif
#if defined (ARITH_FOR_COMMAND)
      case cm_arith_for: return command->value.ArithFor->line;
#endif
      case cm_subshell: return command->value.Subshell->line;
      case cm_function_def: return command->value.Function_def->line;
      case cm_if: command = command->value.If->test; break;
      case cm_while: case cm_until: command = command->value.While->test; break;
      case cm_group: command = command->value.Group->command; break;
      case cm_coproc: command = command->value.Coproc->command; break;
      case cm_connection: command = command->value.Connection->first; break;
      default: return 0;
      }
  return 0;
}

static void
pt_signal (COMMAND *command)
{
  int e;

  command->flags &= ~CMD_PT_TOP;
  e = errno;
  prctl (PT_PRCTL, ++pt_ordinal, pt_line (command), 0, 0);
  errno = e;
}

'''
# Before execute_command_internal's definition, its return type on the line above.
edit('execute_cmd.c', r'^(int\n)(execute_command_internal \()',
     lambda m: HOOKS + m[1] + m[2])

# After the early return for no command, before traps run.
edit('execute_cmd.c', r'^(  if \(command == 0(?: \|\| read_but_dont_execute)?\)\n    return \(EXECUTION_SUCCESS\);\n)',
     lambda m: m[1] + '\n  if (command->flags & CMD_PT_TOP)\n    pt_signal (command);\n')

edit('builtins/evalstring.c',
     r'^(\t      if \(\(subshell_environment & SUBSHELL_COMSUB\) && comsub_ignore_return\)\n\t\tcommand->flags \|= CMD_IGNORE_RETURN;\n)',
     lambda m: m[1] + '''
	      /* pine·trie: only the -c string's own statements, not eval's,
		 a sourced file's, a trap's or a command substitution's. */
	      if (parse_and_execute_level == 1 && from_file && STREQ (from_file, "-c") &&
		  (subshell_environment & SUBSHELL_COMSUB) == 0 && running_trap == 0)
		pt_mark_statements (command);
''')
print(f'{root}: patched')
