import { useEffect, useState, useRef, useCallback } from "react";
import { useApp } from "../context/AppContext";
import { apiRequest } from "../lib/api";
import { useI18n } from "../i18n";
import PhotoUpload from "../components/PhotoUpload";
import Pagination, { paginate, totalPages } from "../components/Pagination";
import {
  formatDate,
  initials,
  isValidIndianPhone,
  stripIndianPrefix,
  normalizeIndianPhone,
  type FamilyMemberRow,
  type LinkedMemberProfile,
  type MemberDashboard,
} from "../types";

interface SearchResult {
  id: string;
  full_name: string;
  phone_number: string | null;
  is_linked: boolean;
  has_pending_request: boolean;
  has_active_account: boolean;
  eligible: boolean;
}

interface FamilyRequest {
  id: string;
  target_member_id: string;
  target_name: string;
  relation: string;
  status: string;
  review_note: string | null;
  rejection_reason: string | null;
  created_at: string;
}

interface SpecialDateRow {
  id: string;
  member_id: string;
  church_id: string;
  occasion_type: "birthday" | "anniversary";
  occasion_date: string;
  person_name: string;
  spouse_name: string | null;
  notes: string | null;
  is_from_profile: boolean;
  created_at: string;
}

export default function ProfilePage() {
  const {
    token,
    userEmail,
    userPhone,
    authContext,
    setAuthContext,
    isSuperAdmin,
    isChurchAdmin,
    memberDashboard,
    setMemberDashboard,
    refreshMemberDashboard,
    busyKey,
    setNotice,
    withAuthRequest,
    openOperationConfirmDialog,
  } = useApp();
  const { t } = useI18n();

  // ── Profile form state ──
  const [profileName, setProfileName] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [profileAddress, setProfileAddress] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileAltPhone, setProfileAltPhone] = useState("");
  const [profileGender, setProfileGender] = useState("");
  const [profileDob, setProfileDob] = useState("");
  const [profileOccupation, setProfileOccupation] = useState("");
  const [profileConfirmationTaken, setProfileConfirmationTaken] = useState<boolean | null>(null);
  const [profileAge, setProfileAge] = useState("");
  const [profileEditing, setProfileEditing] = useState(false);

  const occupationOptions = [
    "Farmer", "Teacher", "Business", "Government Employee", "Private Employee",
    "Self Employed", "Student", "Retired", "Homemaker", "Pastor", "Other",
  ];

  // ── Phone change OTP state ──
  const [originalPhone, setOriginalPhone] = useState("");
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneOtpCode, setPhoneOtpCode] = useState("");
  const [phoneChangeToken, setPhoneChangeToken] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneOtpBusy, setPhoneOtpBusy] = useState(false);

  const phoneChanged = profilePhone !== originalPhone;

  // ── Family member search (replaces manual add) ──
  const [familySearchQuery, setFamilySearchQuery] = useState("");
  const [familySearchResults, setFamilySearchResults] = useState<SearchResult[]>([]);
  const [familySearching, setFamilySearching] = useState(false);
  const [selectedMember, setSelectedMember] = useState<SearchResult | null>(null);
  const [familyRelation, setFamilyRelation] = useState("");
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Family requests (pending/approved/rejected) ──
  const [familyRequests, setFamilyRequests] = useState<FamilyRequest[]>([]);
  const [, setLoadingRequests] = useState(false);

  // ── Family member edit form ──
  const [editingFamilyMemberId, setEditingFamilyMemberId] = useState<string | null>(null);
  const [editFamilyName, setEditFamilyName] = useState("");
  const [editFamilyGender, setEditFamilyGender] = useState("");
  const [editFamilyRelation, setEditFamilyRelation] = useState("");
  const [editFamilyAge, setEditFamilyAge] = useState("");
  const [editFamilyDob, setEditFamilyDob] = useState("");

  // ── Expandable family member profile ──
  const [expandedFamilyId, setExpandedFamilyId] = useState<string | null>(null);
  const [expandedProfile, setExpandedProfile] = useState<LinkedMemberProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  // Editable linked profile fields
  const [editLinkedAddress, setEditLinkedAddress] = useState("");
  const [editLinkedPhone, setEditLinkedPhone] = useState("");
  const [editLinkedAltPhone, setEditLinkedAltPhone] = useState("");
  const [editLinkedOccupation, setEditLinkedOccupation] = useState("");
  const [editLinkedConfirmation, setEditLinkedConfirmation] = useState<boolean | null>(null);
  // Family member phone OTP state
  const [origLinkedPhone, setOrigLinkedPhone] = useState("");
  const [famPhoneOtpSent, setFamPhoneOtpSent] = useState(false);
  const [famPhoneOtpCode, setFamPhoneOtpCode] = useState("");
  const [famPhoneChangeToken, setFamPhoneChangeToken] = useState("");
  const [famPhoneVerified, setFamPhoneVerified] = useState(false);
  const [famPhoneOtpBusy, setFamPhoneOtpBusy] = useState(false);
  const famPhoneChanged = editLinkedPhone !== origLinkedPhone;

  // ── Special Dates ──
  const [specialDates, setSpecialDates] = useState<SpecialDateRow[]>([]);
  const [sdOccasionType, setSdOccasionType] = useState<"birthday" | "anniversary">("birthday");
  const [sdDate, setSdDate] = useState("");
  const [sdPersonName, setSdPersonName] = useState("");
  const [sdSpouseName, setSdSpouseName] = useState("");
  const [sdNotes, setSdNotes] = useState("");
  const [sdAdding, setSdAdding] = useState(false);

  // ── Tab state ──
  const [activeProfileTab, setActiveProfileTab] = useState<"personal" | "family" | "dates">("personal");

  // ── Pagination ──
  const [familyPage, setFamilyPage] = useState(1);
  const [specialDatesPage, setSpecialDatesPage] = useState(1);
  const [subsPage, setSubsPage] = useState(1);
  const ITEMS_PER_PAGE = 5;

  const loadSpecialDates = useCallback(async () => {
    if (!token || !memberDashboard?.member?.id) return;
    try {
      const res = await apiRequest<{ data: SpecialDateRow[] }>(
        `/api/special-dates/list?member_id=${memberDashboard.member.id}`,
        { method: "GET", token },
      );
      setSpecialDates(res?.data || []);
    } catch {
      setSpecialDates([]);
    }
  }, [token, memberDashboard?.member?.id]);

  useEffect(() => {
    loadSpecialDates();
  }, [loadSpecialDates]);

  async function addSpecialDate() {
    if (!token || !memberDashboard?.member?.id) return;
    if (!sdDate) { setNotice({ tone: "error", text: t("profile.pleaseSelectDate") }); return; }
    if (!sdPersonName.trim()) { setNotice({ tone: "error", text: t("profile.pleaseEnterName") }); return; }
    if (sdOccasionType === "anniversary" && !sdSpouseName.trim()) {
      setNotice({ tone: "error", text: t("profile.pleaseEnterSpouseName") }); return;
    }

    // Check DOB conflict for birthday type
    if (sdOccasionType === "birthday") {
      try {
        const check = await apiRequest<{ isDuplicate: boolean; memberDob: string | null }>(
          `/api/special-dates/check-dob?member_id=${memberDashboard.member.id}&occasion_date=${sdDate}`,
          { method: "GET", token },
        );
        if (check?.isDuplicate) {
          const confirmed = await new Promise<boolean>((resolve) => {
            openOperationConfirmDialog(
              t("profile.dobConflictTitle") || "Date Conflict",
              t("profile.dobConflictConfirm"),
              "CONFIRM",
              () => { resolve(true); },
            );
            // If dialog is dismissed without confirming, resolve false after a timeout
            setTimeout(() => resolve(false), 60000);
          });
          if (!confirmed) return;
        }
      } catch { /* ignore check errors, proceed */ }
    }

    setSdAdding(true);
    try {
      await apiRequest("/api/special-dates", {
        method: "POST",
        token,
        body: {
          member_id: memberDashboard.member.id,
          occasion_type: sdOccasionType,
          occasion_date: sdDate,
          person_name: sdPersonName.trim(),
          spouse_name: sdOccasionType === "anniversary" ? sdSpouseName.trim() : undefined,
          notes: sdNotes.trim() || undefined,
        },
      });
      setNotice({ tone: "success", text: t("profile.specialDateAdded") });
      setSdDate(""); setSdPersonName(""); setSdSpouseName(""); setSdNotes("");
      setSdOccasionType("birthday");
      await loadSpecialDates();
    } catch (err: any) {
      setNotice({ tone: "error", text: err?.message || t("profile.failedAddSpecialDate") });
    } finally {
      setSdAdding(false);
    }
  }

  async function deleteSpecialDate(id: string) {
    if (!token) return;
    openOperationConfirmDialog(
      t("profile.deleteSpecialDateTitle") || "Delete Special Date",
      t("profile.deleteSpecialDateConfirm"),
      "DELETE",
      async () => {
        try {
          await apiRequest(`/api/special-dates/${id}`, { method: "DELETE", token });
          setNotice({ tone: "success", text: t("profile.specialDateRemoved") });
          await loadSpecialDates();
        } catch (err: any) {
          setNotice({ tone: "error", text: err?.message || t("profile.failedDelete") });
        }
      },
    );
  }

  // ── Sync profile form when data changes ──
  useEffect(() => {
    if (!authContext) return;
    setProfileName(authContext.profile.full_name || "");
    setProfileAvatarUrl(authContext.profile.avatar_url || "");
    setProfileAddress(memberDashboard?.member?.address || "");
    const phone = stripIndianPrefix(memberDashboard?.member?.phone_number || "");
    setProfilePhone(phone);
    setOriginalPhone(phone);
    setProfileAltPhone(stripIndianPrefix(memberDashboard?.member?.alt_phone_number || ""));
    setProfileGender(memberDashboard?.member?.gender || "");
    setProfileDob(memberDashboard?.member?.dob || "");
    setProfileOccupation(memberDashboard?.member?.occupation || "");
    setProfileConfirmationTaken(memberDashboard?.member?.confirmation_taken ?? null);
    setProfileAge(memberDashboard?.member?.age != null ? String(memberDashboard.member.age) : "");
    setProfileEditing(false);
    setPhoneOtpSent(false);
    setPhoneOtpCode("");
    setPhoneChangeToken("");
    setPhoneVerified(false);
  }, [
    authContext,
    memberDashboard?.member?.address,
    memberDashboard?.member?.phone_number,
    memberDashboard?.member?.alt_phone_number,
    memberDashboard?.member?.gender,
    memberDashboard?.member?.dob,
    memberDashboard?.member?.occupation,
    memberDashboard?.member?.confirmation_taken,
    memberDashboard?.member?.age,
  ]);

  // ── Handlers ──
  function cancelProfileEdit() {
    if (!authContext) return;
    setProfileName(authContext.profile.full_name || "");
    setProfileAvatarUrl(authContext.profile.avatar_url || "");
    setProfileAddress(memberDashboard?.member?.address || "");
    setProfilePhone(stripIndianPrefix(memberDashboard?.member?.phone_number || ""));
    setProfileAltPhone(stripIndianPrefix(memberDashboard?.member?.alt_phone_number || ""));
    setProfileGender(memberDashboard?.member?.gender || "");
    setProfileDob(memberDashboard?.member?.dob || "");
    setProfileOccupation(memberDashboard?.member?.occupation || "");
    setProfileConfirmationTaken(memberDashboard?.member?.confirmation_taken ?? null);
    setProfileAge(memberDashboard?.member?.age != null ? String(memberDashboard.member.age) : "");
    setProfileEditing(false);
    setPhoneOtpSent(false);
    setPhoneOtpCode("");
    setPhoneChangeToken("");
    setPhoneVerified(false);
  }

  async function sendPhoneOtp() {
    const normalizedPhone = profilePhone.trim() ? normalizeIndianPhone(profilePhone) : "";
    if (!normalizedPhone || !isValidIndianPhone(normalizedPhone)) {
      setNotice({ tone: "error", text: t("profile.errorInvalidPhone10Digit") }); return;
    }
    setPhoneOtpBusy(true);
    try {
      await apiRequest("/api/otp/send", { method: "POST", body: { phone: normalizedPhone } });
      setPhoneOtpSent(true);
      setNotice({ tone: "success", text: t("profile.otpSentNewPhone") });
    } catch (err: any) {
      setNotice({ tone: "error", text: err?.message || t("profile.errorSendOtpFailed") });
    } finally {
      setPhoneOtpBusy(false);
    }
  }

  async function verifyPhoneOtp() {
    if (!phoneOtpCode.trim()) {
      setNotice({ tone: "error", text: t("profile.errorOtpRequired") }); return;
    }
    const normalizedPhone = normalizeIndianPhone(profilePhone);
    setPhoneOtpBusy(true);
    try {
      const resp = await apiRequest<{ success: boolean; phone_change_token: string }>(
        "/api/otp/verify-phone-change",
        { method: "POST", token, body: { phone: normalizedPhone, otp: phoneOtpCode.trim() } },
      );
      if (resp?.phone_change_token) {
        setPhoneChangeToken(resp.phone_change_token);
        setPhoneVerified(true);
        setNotice({ tone: "success", text: t("profile.successPhoneVerified") });
      }
    } catch (err: any) {
      setNotice({ tone: "error", text: err?.message || t("profile.otpVerificationFailed") });
    } finally {
      setPhoneOtpBusy(false);
    }
  }

  async function updateProfile() {
    const normalizedPhone = profilePhone.trim() ? normalizeIndianPhone(profilePhone) : "";
    const normalizedAltPhone = profileAltPhone.trim() ? normalizeIndianPhone(profileAltPhone) : "";
    if (normalizedPhone && !isValidIndianPhone(normalizedPhone)) {
      setNotice({ tone: "error", text: t("profile.errorInvalidIndianPhone") }); return;
    }
    if (normalizedAltPhone && !isValidIndianPhone(normalizedAltPhone)) {
      setNotice({ tone: "error", text: t("profile.errorInvalidAlternatePhone") }); return;
    }
    if (phoneChanged && !phoneVerified) {
      setNotice({ tone: "error", text: t("profile.errorUnverifiedPhoneChange") }); return;
    }
    const result = await withAuthRequest(
      "update-profile",
      () =>
        apiRequest<MemberDashboard>("/api/auth/update-profile", {
          method: "POST",
          token,
          body: {
            full_name: profileName,
            avatar_url: profileAvatarUrl,
            address: profileAddress,
            phone_number: normalizedPhone,
            alt_phone_number: normalizedAltPhone,
            gender: profileGender || undefined,
            dob: profileDob || undefined,
            occupation: profileOccupation || undefined,
            confirmation_taken: profileConfirmationTaken !== null ? profileConfirmationTaken : undefined,
            age: profileAge.trim() ? Number(profileAge) : undefined,
            ...(phoneChanged && phoneChangeToken ? { phone_change_token: phoneChangeToken } : {}),
          },
        }),
      t("profile.profileUpdated"),
    );

    if (!result || !authContext) return;
    setMemberDashboard(result);
    setAuthContext({ ...authContext, profile: result.profile });
    setProfileEditing(false);
  }

  // ── Debounced member search ──
  function handleFamilySearch(query: string) {
    setFamilySearchQuery(query);
    setSelectedMember(null);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!query.trim() || query.trim().length < 2) {
      setFamilySearchResults([]);
      return;
    }
    searchTimeoutRef.current = setTimeout(async () => {
      setFamilySearching(true);
      try {
        const results = await apiRequest<SearchResult[]>(
          `/api/auth/family-search?q=${encodeURIComponent(query.trim())}`,
          { method: "GET", token },
        );
        setFamilySearchResults(results || []);
      } catch {
        setFamilySearchResults([]);
      } finally {
        setFamilySearching(false);
      }
    }, 400);
  }

  // ── Load family requests ──
  async function loadFamilyRequests() {
    if (!token) return;
    setLoadingRequests(true);
    try {
      const data = await apiRequest<FamilyRequest[]>("/api/auth/family-requests", {
        method: "GET",
        token,
      });
      setFamilyRequests(data || []);
    } catch {
      setFamilyRequests([]);
    } finally {
      setLoadingRequests(false);
    }
  }

  useEffect(() => {
    if (token) loadFamilyRequests();
  }, [token]);

  // ── Submit family request ──
  async function submitFamilyRequest() {
    if (!selectedMember) {
      setNotice({ tone: "error", text: t("profile.pleaseSelectMember") });
      return;
    }
    if (!familyRelation.trim()) {
      setNotice({ tone: "error", text: t("profile.pleaseSelectRelation") });
      return;
    }

    const result = await withAuthRequest(
      "add-family-request",
      () =>
        apiRequest<{ id: string }>("/api/auth/family-requests", {
          method: "POST",
          token,
          body: {
            target_member_id: selectedMember.id,
            relation: familyRelation.trim(),
          },
        }),
      t("profile.familyRequestSubmitted"),
    );

    if (result) {
      setFamilySearchQuery("");
      setFamilySearchResults([]);
      setSelectedMember(null);
      setFamilyRelation("");
      await loadFamilyRequests();
    }
  }

  function startEditFamilyMember(fm: FamilyMemberRow) {
    setEditingFamilyMemberId(fm.id);
    setEditFamilyName(fm.full_name);
    setEditFamilyGender(fm.gender || "");
    setEditFamilyRelation(fm.relation || "");
    setEditFamilyAge(fm.age != null ? String(fm.age) : "");
    setEditFamilyDob(fm.dob || "");
    // Pre-fill linked profile fields if expanded
    if (expandedFamilyId === fm.id && expandedProfile) {
      setEditLinkedAddress(expandedProfile.address || "");
      setEditLinkedPhone(expandedProfile.phone_number || "");
      setOrigLinkedPhone(expandedProfile.phone_number || "");
      setEditLinkedAltPhone(expandedProfile.alt_phone_number || "");
      setEditLinkedOccupation(expandedProfile.occupation || "");
      setEditLinkedConfirmation(expandedProfile.confirmation_taken);
    }
    // Reset family phone OTP state
    setFamPhoneOtpSent(false);
    setFamPhoneOtpCode("");
    setFamPhoneChangeToken("");
    setFamPhoneVerified(false);
  }

  function cancelEditFamilyMember() {
    setEditingFamilyMemberId(null);
    setEditFamilyName("");
    setEditFamilyGender("");
    setEditFamilyRelation("");
    setEditFamilyAge("");
    setEditFamilyDob("");
    setEditLinkedAddress("");
    setEditLinkedPhone("");
    setOrigLinkedPhone("");
    setEditLinkedAltPhone("");
    setEditLinkedOccupation("");
    setEditLinkedConfirmation(null);
    setFamPhoneOtpSent(false);
    setFamPhoneOtpCode("");
    setFamPhoneChangeToken("");
    setFamPhoneVerified(false);
  }

  async function toggleExpandFamily(fm: FamilyMemberRow) {
    if (expandedFamilyId === fm.id) {
      setExpandedFamilyId(null);
      setExpandedProfile(null);
      return;
    }
    setExpandedFamilyId(fm.id);
    setExpandedProfile(null);
    setLoadingProfile(true);
    try {
      const resp = await apiRequest<{ family_member: FamilyMemberRow; linked_profile: LinkedMemberProfile | null }>(
        `/api/auth/family-members/${fm.id}/profile`,
        { method: "GET", token },
      );
      setExpandedProfile(resp?.linked_profile || null);
      // Pre-fill edit fields if we're already editing
      if (editingFamilyMemberId === fm.id && resp?.linked_profile) {
        setEditLinkedAddress(resp.linked_profile.address || "");
        setEditLinkedPhone(resp.linked_profile.phone_number || "");
        setOrigLinkedPhone(resp.linked_profile.phone_number || "");
        setEditLinkedAltPhone(resp.linked_profile.alt_phone_number || "");
        setEditLinkedOccupation(resp.linked_profile.occupation || "");
        setEditLinkedConfirmation(resp.linked_profile.confirmation_taken);
      }
    } catch {
      setExpandedProfile(null);
    } finally {
      setLoadingProfile(false);
    }
  }

  // ── Family member phone OTP send / verify ──
  async function sendFamPhoneOtp() {
    const normalizedPhone = editLinkedPhone.trim() ? normalizeIndianPhone(editLinkedPhone) : "";
    if (!normalizedPhone || !isValidIndianPhone(normalizedPhone)) {
      setNotice({ tone: "error", text: t("profile.errorInvalidPhone10Digit") });
      return;
    }
    setFamPhoneOtpBusy(true);
    try {
      await apiRequest("/api/otp/send", { method: "POST", body: { phone: normalizedPhone } });
      setFamPhoneOtpSent(true);
      setNotice({ tone: "success", text: t("profile.otpSentNewPhone") });
    } catch (err: any) {
      setNotice({ tone: "error", text: err?.message || t("profile.errorSendOtpFailed") });
    } finally {
      setFamPhoneOtpBusy(false);
    }
  }

  async function verifyFamPhoneOtp() {
    if (!famPhoneOtpCode.trim()) {
      setNotice({ tone: "error", text: t("profile.errorOtpRequired") });
      return;
    }
    const normalizedPhone = normalizeIndianPhone(editLinkedPhone);
    setFamPhoneOtpBusy(true);
    try {
      const resp = await apiRequest<{ success: boolean; phone_change_token: string }>(
        "/api/otp/verify-phone-change",
        { method: "POST", token, body: { phone: normalizedPhone, otp: famPhoneOtpCode.trim() } },
      );
      if (resp?.phone_change_token) {
        setFamPhoneChangeToken(resp.phone_change_token);
        setFamPhoneVerified(true);
        setNotice({ tone: "success", text: t("profile.successPhoneVerified") });
      }
    } catch (err: any) {
      setNotice({ tone: "error", text: err?.message || t("profile.otpVerificationFailed") });
    } finally {
      setFamPhoneOtpBusy(false);
    }
  }

  async function saveEditFamilyMember() {
    if (!editingFamilyMemberId) return;
    const fm = memberDashboard?.family_members?.find((f) => f.id === editingFamilyMemberId);
    const body: Record<string, unknown> = {
      full_name: editFamilyName.trim() || undefined,
      gender: editFamilyGender.trim() || undefined,
      relation: editFamilyRelation.trim() || undefined,
      age: editFamilyAge.trim() ? Number(editFamilyAge) : undefined,
      dob: editFamilyDob || undefined,
    };
    // Include linked-profile-only fields if this member is linked
    if (fm?.linked_to_member_id) {
      body.address = editLinkedAddress;
      body.alt_phone_number = editLinkedAltPhone;
      body.occupation = editLinkedOccupation;
      if (editLinkedConfirmation !== null) body.confirmation_taken = editLinkedConfirmation;
      // Phone change requires OTP verification
      if (famPhoneChanged) {
        if (!famPhoneVerified || !famPhoneChangeToken) {
          setNotice({ tone: "error", text: t("profile.verifyPhoneBeforeSave") });
          return;
        }
        body.phone_number = editLinkedPhone;
        body.phone_change_token = famPhoneChangeToken;
      } else {
        body.phone_number = editLinkedPhone;
      }
    }
    const result = await withAuthRequest(
      "edit-family-member",
      () =>
        apiRequest<FamilyMemberRow>(`/api/auth/family-members/${editingFamilyMemberId}`, {
          method: "PATCH",
          token,
          body,
        }),
      t("profile.familyMemberUpdated"),
    );

    if (result) {
      setEditingFamilyMemberId(null);
      // Re-fetch the expanded profile if it was open
      if (expandedFamilyId === editingFamilyMemberId && fm) {
        toggleExpandFamily(fm);
      }
      await refreshMemberDashboard();
    }
  }

  function removeFamilyMember(familyMemberId: string, name: string) {
    openOperationConfirmDialog(
      t("profile.removeFamilyMember"),
      t("profile.removeFamilyMemberDesc", { name }),
      t("profile.remove"),
      async () => {
        const result = await withAuthRequest(
          "delete-family-member",
          () =>
            apiRequest<{ success: boolean }>(`/api/auth/family-members/${familyMemberId}`, {
              method: "DELETE",
              token,
            }),
          t("profile.familyMemberRemoved"),
        );
        if (result) await refreshMemberDashboard();
      },
    );
  }

  const profileNameDisplay = profileName || userPhone || userEmail;

  const relationOptions = [
    { value: "Spouse", label: t("profile.relationSpouse") },
    { value: "Father", label: t("profile.relationFather") },
    { value: "Mother", label: t("profile.relationMother") },
    { value: "Son", label: t("profile.relationSon") },
    { value: "Daughter", label: t("profile.relationDaughter") },
    { value: "Brother", label: t("profile.relationBrother") },
    { value: "Sister", label: t("profile.relationSister") },
    { value: "Grandfather", label: t("profile.relationGrandfather") },
    { value: "Grandmother", label: t("profile.relationGrandmother") },
    { value: "Uncle", label: t("profile.relationUncle") },
    { value: "Aunt", label: t("profile.relationAunt") },
    { value: "Nephew", label: t("profile.relationNephew") },
    { value: "Niece", label: t("profile.relationNiece") },
    { value: "Cousin", label: t("profile.relationCousin") },
    { value: "Other", label: t("profile.relationOther") },
  ];

  return (
    <section className="page-grid">
      {/* ── Profile Header Card ── */}
      <article className="panel panel-wide profile-header-card">
        <div className="profile-header">
          <div className="profile-avatar-lg">
            <PhotoUpload
              currentUrl={profileAvatarUrl}
              onUploaded={(url) => {
                setProfileAvatarUrl(url);
                // Auto-save avatar immediately
                apiRequest<MemberDashboard>("/api/auth/update-profile", {
                  method: "POST",
                  token,
                  body: { avatar_url: url },
                }).then((result) => {
                  if (result && authContext) {
                    setMemberDashboard(result);
                    setAuthContext({ ...authContext, profile: { ...authContext.profile, avatar_url: url } });
                    setNotice({ tone: "success", text: t("profile.successPhotoUpdated") });
                  }
                }).catch(() => setNotice({ tone: "error", text: t("profile.errorPhotoUploadedProfileSaveFailed") }));
              }}
              onDeleted={() => {
                setProfileAvatarUrl("");
                apiRequest<MemberDashboard>("/api/auth/update-profile", {
                  method: "POST",
                  token,
                  body: { avatar_url: "" },
                }).then((result) => {
                  if (result && authContext) {
                    setMemberDashboard(result);
                    setAuthContext({ ...authContext, profile: { ...authContext.profile, avatar_url: "" } });
                    setNotice({ tone: "success", text: t("profile.successPhotoRemoved") });
                  }
                }).catch(() => setNotice({ tone: "error", text: t("profile.errorPhotoDeletedProfileSaveFailed") }));
              }}
              token={token || ""}
              folder="avatars"
              size={88}
              fallback={
                <div className="avatar avatar-lg avatar-fallback" style={{ width: "100%", height: "100%", fontSize: "1.5rem" }}>
                  {initials(profileName, userPhone || userEmail)}
                </div>
              }
            />
          </div>
          <div className="profile-header-info">
            <h2>{profileNameDisplay}</h2>
            <span className="profile-role-badge">
              {isSuperAdmin ? t("profile.superAdmin") : isChurchAdmin ? t("profile.admin") : t("profile.member")}
            </span>
            <p className="muted">{userPhone || authContext?.profile.email}</p>

          </div>
        </div>
      </article>

      {/* ── Profile Tab Bar ── */}
      <div className="profile-tabs panel-wide">
        <button className={`profile-tab${activeProfileTab === "personal" ? " active" : ""}`} onClick={() => setActiveProfileTab("personal")}>{t("profile.tabPersonal")}</button>
        {!isSuperAdmin && <button className={`profile-tab${activeProfileTab === "family" ? " active" : ""}`} onClick={() => setActiveProfileTab("family")}>{t("profile.tabFamily")}</button>}
        <button className={`profile-tab${activeProfileTab === "dates" ? " active" : ""}`} onClick={() => setActiveProfileTab("dates")}>{t("profile.tabDates")}</button>
      </div>

      {/* ── Personal Details ── */}
      {activeProfileTab === "personal" && (
      <article className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>{t("profile.personalDetails")}</h3>
          {!profileEditing && (
            <button className="btn" type="button" onClick={() => setProfileEditing(true)}>
              {t("profile.editProfile")}
            </button>
          )}
        </div>

        {!profileEditing ? (
          /* ── Read-only view ── */
          <div className="detail-list" style={{ display: "grid", gap: "0.75rem", marginTop: "0.5rem" }}>
            <div className="detail-row">
              <span className="detail-label">{t("profile.fullName")}</span>
              <span style={{ fontWeight: 600 }}>{profileName || "—"}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("profile.phoneNumber")}</span>
              <span style={{ fontWeight: 600 }}>{profilePhone ? `+91 ${profilePhone}` : "—"}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("profile.altPhone")}</span>
              <span style={{ fontWeight: 600 }}>{profileAltPhone ? `+91 ${profileAltPhone}` : "—"}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("profile.address")}</span>
              <span style={{ fontWeight: 600, whiteSpace: "pre-wrap" }}>{profileAddress || "—"}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("profile.gender")}</span>
              <span style={{ fontWeight: 600 }}>{profileGender || "—"}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("profile.dateOfBirth")}</span>
              <span style={{ fontWeight: 600 }}>{profileDob ? formatDate(profileDob, false) : "—"}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("profile.occupation")}</span>
              <span style={{ fontWeight: 600 }}>{profileOccupation || "—"}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("profile.confirmationTaken")}</span>
              <span style={{ fontWeight: 600 }}>{profileConfirmationTaken === true ? t("common.yes") : profileConfirmationTaken === false ? t("common.no") : "—"}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("profile.age")}</span>
              <span style={{ fontWeight: 600 }}>{profileAge || "—"}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("profile.membershipId")}</span>
              <span style={{ fontWeight: 600 }}>{memberDashboard?.member?.membership_id || "—"}</span>
            </div>
          </div>
        ) : (
          /* ── Edit form ── */
          <>
            <div className="field-stack">
              <label>
                {t("profile.fullName")}
                <input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder={t("profile.fullNamePlaceholder")}
                  required
                />
                {profileName.trim().length > 0 && profileName.trim().length < 2 && (
                  <span className="field-error">{t("profile.nameMinLength")}</span>
                )}
              </label>
              <label>
                {t("profile.phoneNumber")}
                <div style={{ display: "flex", alignItems: "stretch" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", padding: "0 0.75rem",
                    background: "var(--surface-container)", borderRadius: "var(--radius-md) 0 0 var(--radius-md)",
                    border: "1px solid rgba(220,208,255,0.30)", borderRight: "none",
                    fontWeight: 600, fontSize: "0.9375rem", color: "var(--on-surface)", whiteSpace: "nowrap",
                    userSelect: "none",
                  }}>+91</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={profilePhone}
                    disabled={phoneOtpBusy}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                      setProfilePhone(val);
                      // Reset OTP state when number changes again
                      if (val !== originalPhone) {
                        setPhoneVerified(false);
                        setPhoneChangeToken("");
                        setPhoneOtpCode("");
                        if (val.length < 10) setPhoneOtpSent(false);
                      }
                    }}
                    placeholder="9876543210"
                    required
                    maxLength={10}
                    style={{ borderRadius: "0 var(--radius-md) var(--radius-md) 0" }}
                  />
                </div>
                {profilePhone.trim() && !isValidIndianPhone(normalizeIndianPhone(profilePhone)) && (
                  <span className="field-error">{t("profile.invalidPhone")}</span>
                )}
                {/* OTP verification UI — only when phone is changed */}
                {phoneChanged && profilePhone.length === 10 && isValidIndianPhone(normalizeIndianPhone(profilePhone)) && (
                  <div style={{ marginTop: "0.5rem" }}>
                    {phoneVerified ? (
                      <span style={{ color: "var(--success, #16a34a)", fontWeight: 600, fontSize: "0.875rem" }}>
                        {t("profile.newPhoneVerified")}
                      </span>
                    ) : !phoneOtpSent ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ fontSize: "0.85rem", padding: "0.4rem 1rem" }}
                        onClick={sendPhoneOtp}
                        disabled={phoneOtpBusy}
                      >
                        {phoneOtpBusy ? t("profile.sendingOtp") : t("profile.sendOtpButton")}
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={phoneOtpCode}
                          onChange={(e) => setPhoneOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          placeholder={t("auth.otpPlaceholder")}
                          maxLength={6}
                          style={{ width: "120px" }}
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ fontSize: "0.85rem", padding: "0.4rem 1rem" }}
                          onClick={verifyPhoneOtp}
                          disabled={phoneOtpBusy || phoneOtpCode.length < 4}
                        >
                          {phoneOtpBusy ? t("profile.verifyingOtp") : t("profile.verifyButton")}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}
                          onClick={sendPhoneOtp}
                          disabled={phoneOtpBusy}
                        >
                          {t("profile.resend")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </label>
              <label>
                {t("profile.altPhone")}
                <div style={{ display: "flex", alignItems: "stretch" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", padding: "0 0.75rem",
                    background: "var(--surface-container)", borderRadius: "var(--radius-md) 0 0 var(--radius-md)",
                    border: "1px solid rgba(220,208,255,0.30)", borderRight: "none",
                    fontWeight: 600, fontSize: "0.9375rem", color: "var(--on-surface)", whiteSpace: "nowrap",
                    userSelect: "none",
                  }}>+91</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={profileAltPhone}
                    onChange={(e) => setProfileAltPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="9876543210"
                    maxLength={10}
                    style={{ borderRadius: "0 var(--radius-md) var(--radius-md) 0" }}
                  />
                </div>
                {profileAltPhone.trim() && !isValidIndianPhone(normalizeIndianPhone(profileAltPhone)) && (
                  <span className="field-error">{t("profile.invalidPhone")}</span>
                )}
              </label>
              <label>
                {t("profile.address")}
                <textarea
                  value={profileAddress}
                  onChange={(e) => setProfileAddress(e.target.value)}
                  placeholder={t("profile.addressPlaceholder")}
                />
              </label>
              <label>
                {t("profile.gender")}
                <select
                  value={profileGender}
                  onChange={(e) => setProfileGender(e.target.value)}
                >
                  <option value="">{t("profile.selectGenderOption")}</option>
                  <option value="Male">{t("profile.male")}</option>
                  <option value="Female">{t("profile.female")}</option>
                </select>
              </label>
              <label>
                {t("profile.dateOfBirth")}
                <input
                  type="date"
                  value={profileDob}
                  onChange={(e) => setProfileDob(e.target.value)}
                />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <label>
                {t("profile.occupation")}
                <select
                  value={profileOccupation}
                  onChange={(e) => setProfileOccupation(e.target.value)}
                >
                  <option value="">{t("profile.selectOccupation")}</option>
                  {occupationOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label>
                {t("profile.age")}
                <input
                  type="number"
                  min="1"
                  max="150"
                  value={profileAge}
                  onChange={(e) => setProfileAge(e.target.value)}
                />
              </label>
            </div>
            <label>
              {t("profile.confirmationTaken")}
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.25rem" }}>
                <button type="button" className={`btn btn-sm ${profileConfirmationTaken === true ? "btn-primary" : "btn-outline"}`} onClick={() => setProfileConfirmationTaken(true)}>{t("common.yes")}</button>
                <button type="button" className={`btn btn-sm ${profileConfirmationTaken === false ? "btn-primary" : "btn-outline"}`} onClick={() => setProfileConfirmationTaken(false)}>{t("common.no")}</button>
              </div>
            </label>
            <div className="actions-row" style={{ marginTop: "0.75rem" }}>
              <button
                className="btn btn-primary"
                onClick={updateProfile}
                disabled={busyKey === "update-profile"}
              >
                {busyKey === "update-profile" ? t("common.saving") : t("profile.saveProfile")}
              </button>
              <button
                className="btn"
                type="button"
                onClick={cancelProfileEdit}
                disabled={busyKey === "update-profile"}
              >
                {t("common.cancel")}
              </button>
            </div>
          </>
        )}
      </article>
      )}

      {/* ── Family Members ── */}
      {activeProfileTab === "family" && !isSuperAdmin ? (
        <article className="panel panel-wide">
          <h3>{t("profile.familyMembers")}</h3>
          <div className="list-stack">
            {memberDashboard?.family_members?.length ? (
              <>
              {paginate(memberDashboard.family_members, familyPage, ITEMS_PER_PAGE).map((fm) => {
                const isExpanded = expandedFamilyId === fm.id;
                const isEditing = editingFamilyMemberId === fm.id;
                return (
                <div key={fm.id} className="list-item" style={{ cursor: "pointer", transition: "all 0.2s" }}>
                  {/* ── Collapsed header (always visible, clickable to toggle) ── */}
                  <div
                    onClick={() => !isEditing && toggleExpandFamily(fm)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <div>
                      <strong>{fm.full_name}</strong>
                      {fm.linked_to_member_id && (
                        <span style={{ fontSize: "0.75rem", fontWeight: 600, padding: "0.1rem 0.4rem", borderRadius: "4px", background: "#e0f2fe", color: "#0369a1", marginLeft: 6 }}>{t("profile.linked")}</span>
                      )}
                      <span style={{ display: "block", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                        {fm.relation || t("profile.relationNotSet")}
                        {fm.gender ? ` · ${fm.gender}` : ""}
                      </span>
                    </div>
                    <span style={{ fontSize: "1.1rem", transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▼</span>
                  </div>

                  {/* ── Expanded profile details ── */}
                  {isExpanded && (
                    <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                      {isEditing ? (
                        <>
                          <div className="field-stack" style={{ gap: "0.5rem" }}>
                            <label>
                              {t("profile.name")}
                              <input value={editFamilyName} onChange={(e) => setEditFamilyName(e.target.value)} />
                            </label>
                            <label>
                              {t("profile.gender")}
                              <select value={editFamilyGender} onChange={(e) => setEditFamilyGender(e.target.value)}>
                                <option value="">{t("profile.selectGender")}</option>
                                <option value="Male">{t("profile.male")}</option>
                                <option value="Female">{t("profile.female")}</option>
                              </select>
                            </label>
                            <label>
                              {t("profile.relation")}
                              <select value={editFamilyRelation} onChange={(e) => setEditFamilyRelation(e.target.value)}>
                                <option value="">{t("profile.selectRelation")}</option>
                                {relationOptions.map((r) => (
                                  <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              {t("profile.dateOfBirth")}
                              <input type="date" value={editFamilyDob} onChange={(e) => setEditFamilyDob(e.target.value)} />
                            </label>
                            {/* Linked-profile-only fields */}
                            {fm.linked_to_member_id && (
                              <>
                                <label>
                                  {t("profile.address")}
                                  <input value={editLinkedAddress} onChange={(e) => setEditLinkedAddress(e.target.value)} />
                                </label>
                                <label>
                                  {t("profile.phoneNumber")}
                                  <input value={editLinkedPhone} onChange={(e) => {
                                    setEditLinkedPhone(e.target.value);
                                    // Reset OTP state when phone changes
                                    if (e.target.value !== origLinkedPhone) {
                                      setFamPhoneOtpSent(false);
                                      setFamPhoneOtpCode("");
                                      setFamPhoneChangeToken("");
                                      setFamPhoneVerified(false);
                                    }
                                  }} />
                                </label>
                                {/* Family phone OTP verification */}
                                {famPhoneChanged && editLinkedPhone.length === 10 && isValidIndianPhone(normalizeIndianPhone(editLinkedPhone)) && (
                                  <div style={{ marginTop: "0.25rem", marginBottom: "0.25rem" }}>
                                    {famPhoneVerified ? (
                                      <span style={{ color: "var(--success, #16a34a)", fontWeight: 600, fontSize: "0.875rem" }}>
                                        {t("profile.newPhoneVerified")}
                                      </span>
                                    ) : !famPhoneOtpSent ? (
                                      <button
                                        type="button"
                                        className="btn btn-primary"
                                        style={{ fontSize: "0.85rem", padding: "0.4rem 1rem" }}
                                        onClick={sendFamPhoneOtp}
                                        disabled={famPhoneOtpBusy}
                                      >
                                        {famPhoneOtpBusy ? t("profile.sendingOtp") : t("profile.sendOtpButton")}
                                      </button>
                                    ) : (
                                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          value={famPhoneOtpCode}
                                          onChange={(e) => setFamPhoneOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                          placeholder={t("auth.otpPlaceholder")}
                                          maxLength={6}
                                          style={{ width: "120px" }}
                                        />
                                        <button
                                          type="button"
                                          className="btn btn-primary"
                                          style={{ fontSize: "0.85rem", padding: "0.4rem 1rem" }}
                                          onClick={verifyFamPhoneOtp}
                                          disabled={famPhoneOtpBusy || famPhoneOtpCode.length < 4}
                                        >
                                          {famPhoneOtpBusy ? t("profile.verifyingOtp") : t("profile.verifyButton")}
                                        </button>
                                        <button
                                          type="button"
                                          className="btn"
                                          style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}
                                          onClick={sendFamPhoneOtp}
                                          disabled={famPhoneOtpBusy}
                                        >
                                          {t("profile.resend")}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                                <label>
                                  {t("profile.altPhone")}
                                  <input value={editLinkedAltPhone} onChange={(e) => setEditLinkedAltPhone(e.target.value)} />
                                </label>
                                <label>
                                  {t("profile.occupation")}
                                  <select value={editLinkedOccupation} onChange={(e) => setEditLinkedOccupation(e.target.value)}>
                                    <option value="">{t("profile.selectOccupation")}</option>
                                    {occupationOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                  <input
                                    type="checkbox"
                                    checked={!!editLinkedConfirmation}
                                    onChange={(e) => setEditLinkedConfirmation(e.target.checked)}
                                    style={{ width: "auto" }}
                                  />
                                  {t("profile.confirmationTaken")}
                                </label>
                              </>
                            )}
                          </div>
                          <div className="actions-row" style={{ marginTop: "0.5rem" }}>
                            <button className="btn btn-primary" onClick={saveEditFamilyMember} disabled={busyKey === "edit-family-member"}>
                              {busyKey === "edit-family-member" ? t("common.saving") : t("common.save")}
                            </button>
                            <button className="btn" onClick={cancelEditFamilyMember}>{t("common.cancel")}</button>
                          </div>
                        </>
                      ) : (
                        <>
                          {loadingProfile && expandedFamilyId === fm.id ? (
                            <p className="muted">{t("common.loading")}</p>
                          ) : (
                            <div className="field-stack" style={{ gap: "0.35rem", fontSize: "0.9rem" }}>
                              <div><strong>{t("profile.dob")}:</strong> {fm.dob ? formatDate(fm.dob, false) : t("common.notSet")}</div>
                              <div><strong>{t("profile.age")}:</strong> {fm.age != null ? fm.age : t("common.notSet")}</div>
                              <div><strong>{t("profile.subscription")}:</strong> {fm.has_subscription ? t("profile.enabled") : t("profile.notEnabled")}</div>
                              {/* Linked profile details */}
                              {expandedProfile && fm.linked_to_member_id && (
                                <>
                                  <div style={{ borderTop: "1px dashed var(--border)", margin: "0.5rem 0", paddingTop: "0.5rem" }}>
                                    <strong style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{t("profile.memberDetails")}</strong>
                                  </div>
                                  {expandedProfile.email && <div><strong>{t("profile.email")}:</strong> {expandedProfile.email}</div>}
                                  {expandedProfile.phone_number && <div><strong>{t("profile.phoneNumber")}:</strong> {expandedProfile.phone_number}</div>}
                                  {expandedProfile.alt_phone_number && <div><strong>{t("profile.altPhone")}:</strong> {expandedProfile.alt_phone_number}</div>}
                                  {expandedProfile.address && <div><strong>{t("profile.address")}:</strong> {expandedProfile.address}</div>}
                                  {expandedProfile.membership_id && <div><strong>{t("profile.membershipId")}:</strong> {expandedProfile.membership_id}</div>}
                                  {expandedProfile.occupation && <div><strong>{t("profile.occupation")}:</strong> {expandedProfile.occupation}</div>}
                                  <div><strong>{t("profile.confirmationTaken")}:</strong> {expandedProfile.confirmation_taken ? t("common.yes") : t("common.no")}</div>
                                  {expandedProfile.subscription_amount != null && <div><strong>{t("profile.subscriptionAmount")}:</strong> ₹{Number(expandedProfile.subscription_amount).toFixed(2)}</div>}
                                </>
                              )}
                              {!fm.linked_to_member_id && !expandedProfile && (
                                <div className="muted" style={{ fontSize: "0.82rem", fontStyle: "italic" }}>
                                  {t("profile.manualFamilyMember")}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="actions-row" style={{ marginTop: "0.5rem" }}>
                            <button className="btn" onClick={() => startEditFamilyMember(fm)} disabled={!!busyKey}>
                              {t("common.edit")}
                            </button>
                            <button className="btn btn-danger" onClick={() => removeFamilyMember(fm.id, fm.full_name)} disabled={!!busyKey}>
                              {t("common.remove")}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
              <Pagination page={familyPage} total={totalPages(memberDashboard.family_members.length, ITEMS_PER_PAGE)} onPageChange={setFamilyPage} />
              </>
            ) : (
              <p className="muted empty-state">{t("profile.noFamilyMembers")}</p>
            )}
          </div>

          <div className="field-stack" style={{ marginTop: "1rem" }}>
            <h4>{t("profile.addFamilyMember")}</h4>
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              {t("profile.searchMemberDescription")}
            </p>
            <label>
              {t("profile.searchMember")}
              <input
                value={familySearchQuery}
                onChange={(e) => handleFamilySearch(e.target.value)}
                placeholder={t("profile.searchPlaceholder")}
              />
            </label>

            {familySearching && <p className="muted">{t("common.searching")}</p>}

            {familySearchResults.length > 0 && !selectedMember && (
              <div className="list-stack" style={{ maxHeight: "200px", overflow: "auto", border: "1px solid var(--border)", borderRadius: "8px", padding: "0.5rem" }}>
                {familySearchResults.map((sr) => (
                  <div
                    key={sr.id}
                    className="list-item"
                    style={{
                      cursor: sr.eligible ? "pointer" : "not-allowed",
                      opacity: sr.eligible ? 1 : 0.5,
                      padding: "0.5rem",
                      borderRadius: "6px",
                      background: sr.eligible ? undefined : "var(--bg-muted, #f5f5f5)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                    onClick={() => {
                      if (sr.eligible) {
                        setSelectedMember(sr);
                        setFamilySearchResults([]);
                      }
                    }}
                  >
                    <div>
                      <strong>{sr.full_name}</strong>
                      {sr.phone_number && (
                        <span className="muted" style={{ fontSize: "0.8rem" }}> &middot; {sr.phone_number}</span>
                      )}
                      {!sr.eligible && (
                        <span className="muted" style={{ fontSize: "0.8rem", display: "block" }}>
                          {sr.is_linked
                            ? t("profile.alreadyInFamily")
                            : sr.has_pending_request
                              ? t("profile.pendingRequestExists")
                              : t("profile.notEligible")}
                        </span>
                      )}
                    </div>
                    {sr.eligible && (
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ fontSize: "0.78rem", padding: "0.25rem 0.6rem", whiteSpace: "nowrap" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedMember(sr);
                          setFamilySearchResults([]);
                        }}
                      >
                        {t("profile.select")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {familySearchQuery.trim().length >= 2 && !familySearching && familySearchResults.length === 0 && !selectedMember && (
              <p className="muted" style={{ fontSize: "0.85rem" }}>{t("profile.noSearchResults")}</p>
            )}

            {selectedMember && (
              <div style={{ padding: "0.75rem", border: "1px solid var(--accent)", borderRadius: "8px", background: "var(--bg-accent, #f0f7ff)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{selectedMember.full_name}</strong>
                  </div>
                  <button
                    className="btn"
                    type="button"
                    style={{ fontSize: "0.8rem" }}
                    onClick={() => {
                      setSelectedMember(null);
                      setFamilySearchQuery("");
                    }}
                  >
                    {t("profile.change")}
                  </button>
                </div>
              </div>
            )}

            {selectedMember && (
              <>
                <label>
                  {t("profile.relation")}
                  <select
                    value={familyRelation}
                    onChange={(e) => setFamilyRelation(e.target.value)}
                  >
                    <option value="">{t("profile.selectRelation")}</option>
                    {relationOptions.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="actions-row">
                  <button
                    className="btn btn-primary"
                    onClick={submitFamilyRequest}
                    disabled={busyKey === "add-family-request"}
                  >
                    {busyKey === "add-family-request" ? t("profile.submitting") : t("profile.submitRequest")}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setSelectedMember(null);
                      setFamilySearchQuery("");
                      setFamilyRelation("");
                    }}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ── Family Requests Status ── */}
          {familyRequests.length > 0 && (
            <div style={{ marginTop: "1.5rem" }}>
              <h4>{t("profile.yourRequests")}</h4>
              <div className="list-stack">
                {familyRequests.map((fr) => (
                  <div key={fr.id} className="list-item family-request-card">
                    <div className="family-request-head">
                      <div className="family-request-name">
                        <strong>{fr.target_name}</strong>
                        <span className="muted"> — {fr.relation}</span>
                      </div>
                      <span
                        className="family-request-status"
                        style={{
                          background:
                            fr.status === "approved"
                              ? "#e6f4ea"
                              : fr.status === "pending"
                                ? "#fff8e1"
                                : "#fde8e8",
                          color:
                            fr.status === "approved"
                              ? "#1b7a3d"
                              : fr.status === "pending"
                                ? "#b8860b"
                                : "#c0392b",
                        }}
                      >
                        {fr.status.charAt(0).toUpperCase() + fr.status.slice(1).replace("_", " ")}
                      </span>
                    </div>
                    {fr.rejection_reason && (
                      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                        {t("profile.reason")} {fr.rejection_reason}
                      </p>
                    )}
                    {fr.review_note && (
                      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                        {t("profile.note")} {fr.review_note}
                      </p>
                    )}
                    <p className="muted" style={{ fontSize: "0.75rem" }}>
                      {t("profile.requested")} {formatDate(fr.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </article>
      ) : null}

      {/* ── Special Dates Section ── */}
      {activeProfileTab === "dates" && memberDashboard?.member && (
        <article className="panel">
          <h3>{t("profile.specialDates")}</h3>
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
            {t("profile.specialDatesDescription")}
            {memberDashboard.member.dob && (
              <> {t("profile.dobAutoIncluded", { dob: formatDate(memberDashboard.member.dob, false) })}</>
            )}
          </p>

          {/* ── Existing special dates ── */}
          {specialDates.length > 0 && (
            <div className="list-stack" style={{ marginBottom: "1.5rem" }}>
              {paginate(specialDates, specialDatesPage, ITEMS_PER_PAGE).map((sd) => (
                <div key={sd.id} className="list-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{sd.person_name}</strong>
                    {sd.spouse_name && <span> &amp; {sd.spouse_name}</span>}
                    <span className="muted" style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}>
                      — {sd.occasion_type === "birthday" ? t("profile.birthdayLabel") : t("profile.anniversaryLabel")}
                    </span>
                    <br />
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      {formatDate(sd.occasion_date, false)}
                      {sd.is_from_profile && ` ${t("profile.fromProfile")}`}
                    </span>
                    {sd.notes && (
                      <span className="muted" style={{ fontSize: "0.75rem", marginLeft: "0.5rem" }}>
                        — {sd.notes}
                      </span>
                    )}
                  </div>
                  {!sd.is_from_profile && (
                    <button
                      className="btn"
                      style={{ fontSize: "0.75rem", color: "#c0392b", padding: "0.2rem 0.5rem" }}
                      onClick={() => deleteSpecialDate(sd.id)}
                    >
                      {t("common.remove")}
                    </button>
                  )}
                </div>
              ))}
              <Pagination page={specialDatesPage} total={totalPages(specialDates.length, ITEMS_PER_PAGE)} onPageChange={setSpecialDatesPage} />
            </div>
          )}

          {/* ── Add new special date form ── */}
          <div className="profile-special-date-form">
            <h4>{t("profile.addSpecialDate")}</h4>
            <div className="profile-sd-form-grid">
              <label>
                {t("profile.type")}
                <select
                  value={sdOccasionType}
                  onChange={(e) => setSdOccasionType(e.target.value as "birthday" | "anniversary")}
                >
                  <option value="birthday">{t("profile.birthday")}</option>
                  <option value="anniversary">{t("profile.anniversary")}</option>
                </select>
              </label>
              <label>
                {t("profile.date")}
                <input type="date" value={sdDate} onChange={(e) => setSdDate(e.target.value)} />
              </label>
              <label>
                {sdOccasionType === "anniversary" ? t("profile.maleName") : t("profile.personName")}
                <input
                  type="text"
                  value={sdPersonName}
                  onChange={(e) => setSdPersonName(e.target.value)}
                  placeholder={sdOccasionType === "anniversary" ? t("profile.husbandsNamePlaceholder") : t("profile.personsNamePlaceholder")}
                />
              </label>
              {sdOccasionType === "anniversary" && (
                <label>
                  {t("profile.femaleName")}
                  <input
                    type="text"
                    value={sdSpouseName}
                    onChange={(e) => setSdSpouseName(e.target.value)}
                    placeholder={t("profile.wifesNamePlaceholder")}
                  />
                </label>
              )}
              <label className="profile-sd-notes-label">
                {t("profile.notesOptional")}
                <input
                  type="text"
                  value={sdNotes}
                  onChange={(e) => setSdNotes(e.target.value)}
                  placeholder={t("profile.notesPlaceholder")}
                />
              </label>
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <button
                className="btn btn-primary"
                onClick={addSpecialDate}
                disabled={sdAdding}
              >
                {sdAdding ? t("profile.adding") : t("profile.addSpecialDate")}
              </button>
            </div>
          </div>
        </article>
      )}

      {/* ── IDs & Subscriptions Table ── */}
      {activeProfileTab === "personal" && memberDashboard?.member && (
        <article className="panel">
          <h3>{t("profile.membershipDetails")}</h3>
          <div className="profile-details-cards">
            {memberDashboard.member.membership_id && (
              <div className="profile-detail-card">
                <span className="profile-detail-label">{t("profile.memberId")}</span>
                <span className="profile-detail-value">{memberDashboard.member.membership_id}</span>
              </div>
            )}
            <div className="profile-detail-card">
              <span className="profile-detail-label">{t("profile.systemId")}</span>
              <span className="profile-detail-value profile-detail-mono">{memberDashboard.member.id}</span>
            </div>
            {paginate(memberDashboard.subscriptions || [], subsPage, ITEMS_PER_PAGE).map((sub) => (
              <div key={sub.id} className="profile-detail-card">
                <span className="profile-detail-label">
                  {t("profile.subscriptionLabel", { plan: sub.plan_name || t("profile.defaultPlan") })}
                  {" "}
                  <span style={{
                    fontSize: "0.7rem", fontWeight: 600, padding: "0.1rem 0.35rem", borderRadius: "4px",
                    background: sub.status === "active" ? "#e6f4ea" : sub.status === "cancelled" ? "#fde8e8" : "#fff8e1",
                    color: sub.status === "active" ? "#1b7a3d" : sub.status === "cancelled" ? "#c0392b" : "#b8860b",
                  }}>{sub.status}</span>
                </span>
                <span className="profile-detail-value profile-detail-mono">{sub.id}</span>
              </div>
            ))}
          </div>
          {(memberDashboard.subscriptions?.length || 0) > ITEMS_PER_PAGE && (
            <Pagination page={subsPage} total={totalPages(memberDashboard.subscriptions?.length || 0, ITEMS_PER_PAGE)} onPageChange={setSubsPage} />
          )}
        </article>
      )}
    </section>
  );
}
