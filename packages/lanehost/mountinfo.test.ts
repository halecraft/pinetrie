import { expect, test } from "vitest"
import { holdingMount } from "./mountinfo.ts"

const info = [
  "22 1 0:21 / / rw,relatime - overlay overlay rw,lowerdir=x",
  "40 22 0:40 / /var/lib/pinetrie-lanes rw,relatime - btrfs /dev/vdb rw,user_subvol_rm_allowed,space_cache=v2",
  "41 22 0:41 / /data rw - btrfs /dev/vdc rw,space_cache=v2",
  "42 22 0:42 / /my\\040lanes rw - btrfs /dev/vdd rw",
].join("\n")

test("the mount holding a directory is the one with the longest point", () => {
  expect(holdingMount(info, "/var/lib/pinetrie-lanes")).toEqual({
    point: "/var/lib/pinetrie-lanes",
    fs: "btrfs",
    source: "/dev/vdb",
    options: ["rw", "user_subvol_rm_allowed", "space_cache=v2"],
  })
  expect(holdingMount(info, "/data/lanes")?.source).toBe("/dev/vdc")
  expect(holdingMount(info, "/home/x")?.fs).toBe("overlay")
  expect(holdingMount(info, "/database")?.point).toBe("/")
})

test("a point with an escaped space is read as written", () => {
  expect(holdingMount(info, "/my lanes/a")?.source).toBe("/dev/vdd")
})

test("text with no mount holds nothing", () => {
  expect(holdingMount("", "/a")).toBeNull()
})
