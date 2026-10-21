# Applied to packages/jj/repo.test.ts for one run, then reverted: turnRig is
# built once, as "template", and each test copies its two directories.
p = "packages/jj/repo.test.ts"; s = open(p).read()
s = s.replace('''  const proposedRig = async (tag: string) => {
    const repoDir = path.join(top, `${tag}-yours`)
    const laneDir = path.join(top, `${tag}-lane`)
    await run("mkdir", ["-p", repoDir, laneDir])
    await run("jj", ["git", "init", "--colocate", repoDir])
''', '''  const proposedRig = async (tag: string, made = false) => {
    const repoDir = path.join(top, `${tag}-yours`)
    const laneDir = path.join(top, `${tag}-lane`)
    if (!made) {
      await run("mkdir", ["-p", repoDir, laneDir])
      await run("jj", ["git", "init", "--colocate", repoDir])
    }
''', 1)
s = s.replace('''  const turnRig = async (tag: string) => {
    const rig = await proposedRig(tag)
''', '''  let template: Promise<{ base: CommitId[]; first: CommitId }> | null = null
  const turnRig = async (tag: string) => {
    template ??= turnRigBuilt("template").then(r => ({ base: [...r.base], first: r.first }))
    const t = await template
    for (const side of ["yours", "lane"])
      await cp(path.join(top, `template-${side}`), path.join(top, `${tag}-${side}`), { recursive: true, verbatimSymlinks: true })
    return { ...(await proposedRig(tag, true)), base: t.base, first: t.first }
  }
  const turnRigBuilt = async (tag: string) => {
    const rig = await proposedRig(tag)
''', 1)
open(p, "w").write(s)
