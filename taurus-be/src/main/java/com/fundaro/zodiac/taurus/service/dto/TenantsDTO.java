package com.fundaro.zodiac.taurus.service.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.hibernate.validator.constraints.URL;

import java.util.Date;
import java.util.Objects;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class TenantsDTO extends CommonFieldsOpenSearchDTO {

    private String code;

    private String email;

    private String domain;

    private Long maxUsers;

    private Date expireDate;

    private Boolean active;
    private String address;
    private String postalCode;
    private String city;
    private String province;

    @Pattern(regexp = "[A-Z]{2}", message = "must be a two-letter uppercase country code")
    private String country;
    private String taxCode;
    private String vatNumber;

    @URL(regexp = "https?://.*", message = "must be a valid HTTP or HTTPS URL")
    @Size(max = 2048)
    private String logoUrl;

    @Size(max = 64)
    private String phone;

    @Email
    @Size(max = 255)
    private String pec;

    @NotBlank
    @Size(max = 64)
    private String timeZone = "Europe/Rome";

    private Boolean financeEnabled = false;
    private Boolean inventoryEnabled = false;
    private Boolean onboardingImportEnabled = false;
    private Boolean externalCalendarFeedEnabled = false;
    private Boolean inventoryQrEnabled = false;
    private Boolean notificationPreferencesEnabled = false;
    private Boolean webPushRemindersEnabled = false;
    private Boolean eventPreparationEnabled = false;
    private Boolean scorePlaybackEnabled = false;
    private Boolean inventoryLoanSheetEnabled = false;
    private Boolean inventorySignatureEnabled = false;
    private Boolean calendarEnabled = false;
    private Boolean eventPayoutsEnabled = false;
    private Boolean scoreWritingEnabled = false;
    private Long entityVersion;

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getDomain() {
        return domain;
    }

    public void setDomain(String domain) {
        this.domain = domain;
    }

    public Long getMaxUsers() {
        return maxUsers;
    }

    public void setMaxUsers(Long maxUsers) {
        this.maxUsers = maxUsers;
    }

    public Date getExpireDate() {
        return expireDate;
    }

    public void setExpireDate(Date expireDate) {
        this.expireDate = expireDate;
    }

    public Boolean getActive() {
        return active;
    }

    public void setActive(Boolean active) {
        this.active = active;
    }

    public String getAddress() {
        return address;
    }

    public void setAddress(String address) {
        this.address = address;
    }

    public String getPostalCode() {
        return postalCode;
    }

    public void setPostalCode(String postalCode) {
        this.postalCode = postalCode;
    }

    public String getCity() {
        return city;
    }

    public void setCity(String city) {
        this.city = city;
    }

    public String getProvince() {
        return province;
    }

    public void setProvince(String province) {
        this.province = province;
    }

    public String getCountry() {
        return country;
    }

    public void setCountry(String country) {
        this.country = country;
    }

    public String getTaxCode() {
        return taxCode;
    }

    public void setTaxCode(String taxCode) {
        this.taxCode = taxCode;
    }

    public String getVatNumber() {
        return vatNumber;
    }

    public void setVatNumber(String vatNumber) {
        this.vatNumber = vatNumber;
    }

    public String getLogoUrl() {
        return logoUrl;
    }

    public void setLogoUrl(String logoUrl) {
        this.logoUrl = logoUrl;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getPec() {
        return pec;
    }

    public void setPec(String pec) {
        this.pec = pec;
    }

    public String getTimeZone() {
        return timeZone;
    }

    public void setTimeZone(String timeZone) {
        this.timeZone = timeZone;
    }

    public Boolean getFinanceEnabled() {
        return financeEnabled;
    }

    public void setFinanceEnabled(Boolean financeEnabled) {
        this.financeEnabled = financeEnabled;
    }

    public Boolean getInventoryEnabled() {
        return inventoryEnabled;
    }

    public void setInventoryEnabled(Boolean inventoryEnabled) {
        this.inventoryEnabled = inventoryEnabled;
    }

    public Boolean getOnboardingImportEnabled() {
        return onboardingImportEnabled;
    }

    public void setOnboardingImportEnabled(Boolean value) {
        onboardingImportEnabled = value;
    }

    public Boolean getExternalCalendarFeedEnabled() {
        return externalCalendarFeedEnabled;
    }

    public void setExternalCalendarFeedEnabled(Boolean value) {
        externalCalendarFeedEnabled = value;
    }

    public Boolean getInventoryQrEnabled() {
        return inventoryQrEnabled;
    }

    public void setInventoryQrEnabled(Boolean value) {
        inventoryQrEnabled = value;
    }

    public Boolean getNotificationPreferencesEnabled() {
        return notificationPreferencesEnabled;
    }

    public void setNotificationPreferencesEnabled(Boolean value) {
        notificationPreferencesEnabled = value;
    }

    public Boolean getWebPushRemindersEnabled() {
        return webPushRemindersEnabled;
    }

    public void setWebPushRemindersEnabled(Boolean value) {
        webPushRemindersEnabled = value;
    }

    public Boolean getEventPreparationEnabled() {
        return eventPreparationEnabled;
    }

    public void setEventPreparationEnabled(Boolean value) {
        eventPreparationEnabled = value;
    }

    public Boolean getScorePlaybackEnabled() {
        return scorePlaybackEnabled;
    }

    public void setScorePlaybackEnabled(Boolean value) {
        scorePlaybackEnabled = value;
    }

    public Boolean getInventoryLoanSheetEnabled() {
        return inventoryLoanSheetEnabled;
    }

    public void setInventoryLoanSheetEnabled(Boolean value) {
        inventoryLoanSheetEnabled = value;
    }

    public Boolean getInventorySignatureEnabled() {
        return inventorySignatureEnabled;
    }

    public void setInventorySignatureEnabled(Boolean value) {
        inventorySignatureEnabled = value;
    }

    public Boolean getCalendarEnabled() {
        return calendarEnabled;
    }

    public void setCalendarEnabled(Boolean value) {
        calendarEnabled = value;
    }

    public Boolean getEventPayoutsEnabled() {
        return eventPayoutsEnabled;
    }

    public void setEventPayoutsEnabled(Boolean value) {
        eventPayoutsEnabled = value;
    }

    public Boolean getScoreWritingEnabled() {
        return scoreWritingEnabled;
    }

    public void setScoreWritingEnabled(Boolean value) {
        scoreWritingEnabled = value;
    }

    public Long getEntityVersion() {
        return entityVersion;
    }

    public void setEntityVersion(Long entityVersion) {
        this.entityVersion = entityVersion;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof TenantsDTO that)) {
            return false;
        }
        return super.equals(that) &&
            Objects.equals(code, that.code) &&
            Objects.equals(email, that.email) &&
            Objects.equals(domain, that.domain) &&
            Objects.equals(maxUsers, that.maxUsers) &&
            Objects.equals(expireDate, that.expireDate) &&
            Objects.equals(active, that.active) &&
            Objects.equals(address, that.address) &&
            Objects.equals(postalCode, that.postalCode) &&
            Objects.equals(city, that.city) &&
            Objects.equals(province, that.province) &&
            Objects.equals(country, that.country) &&
            Objects.equals(taxCode, that.taxCode) &&
            Objects.equals(vatNumber, that.vatNumber) &&
            Objects.equals(logoUrl, that.logoUrl) &&
            Objects.equals(phone, that.phone) &&
            Objects.equals(pec, that.pec) &&
            Objects.equals(timeZone, that.timeZone) &&
            Objects.equals(financeEnabled, that.financeEnabled) &&
            Objects.equals(inventoryEnabled, that.inventoryEnabled) &&
            Objects.equals(onboardingImportEnabled, that.onboardingImportEnabled) &&
            Objects.equals(externalCalendarFeedEnabled, that.externalCalendarFeedEnabled) &&
            Objects.equals(inventoryQrEnabled, that.inventoryQrEnabled) &&
            Objects.equals(notificationPreferencesEnabled, that.notificationPreferencesEnabled) &&
            Objects.equals(webPushRemindersEnabled, that.webPushRemindersEnabled) &&
            Objects.equals(eventPreparationEnabled, that.eventPreparationEnabled) &&
            Objects.equals(scorePlaybackEnabled, that.scorePlaybackEnabled) &&
            Objects.equals(inventoryLoanSheetEnabled, that.inventoryLoanSheetEnabled) &&
            Objects.equals(inventorySignatureEnabled, that.inventorySignatureEnabled) &&
            Objects.equals(calendarEnabled, that.calendarEnabled) &&
            Objects.equals(eventPayoutsEnabled, that.eventPayoutsEnabled) &&
            Objects.equals(scoreWritingEnabled, that.scoreWritingEnabled) &&
            Objects.equals(entityVersion, that.entityVersion);
    }

    @Override
    public int hashCode() {
        return Objects.hash(super.hashCode(), code, email, domain, maxUsers, expireDate, active, address, postalCode, city, province, country, taxCode, vatNumber, logoUrl, phone, pec, timeZone, financeEnabled, inventoryEnabled, onboardingImportEnabled, externalCalendarFeedEnabled, inventoryQrEnabled, notificationPreferencesEnabled, webPushRemindersEnabled, eventPreparationEnabled, scorePlaybackEnabled, inventoryLoanSheetEnabled, inventorySignatureEnabled, calendarEnabled, eventPayoutsEnabled, scoreWritingEnabled, entityVersion);
    }

    @Override
    public String toString() {
        return "TenantsDTO{" +
            "id=" + getId() +
            ", name='" + getName() + "'" +
            ", description='" + getDescription() + "'" +
            ", code='" + code + '\'' +
            ", email='" + email + '\'' +
            ", domain='" + domain + '\'' +
            ", maxUsers=" + maxUsers +
            ", expireDate=" + expireDate +
            ", active=" + active +
            ", address='" + address + '\'' +
            ", postalCode='" + postalCode + '\'' +
            ", city='" + city + '\'' +
            ", province='" + province + '\'' +
            ", country='" + country + '\'' +
            ", taxCode='" + taxCode + '\'' +
            ", vatNumber='" + vatNumber + '\'' +
            ", logoUrl='" + logoUrl + '\'' +
            ", phone='" + phone + '\'' +
            ", pec='" + pec + '\'' +
            ", timeZone='" + timeZone + '\'' +
            ", financeEnabled=" + financeEnabled +
            ", inventoryEnabled=" + inventoryEnabled +
            ", onboardingImportEnabled=" + onboardingImportEnabled +
            ", externalCalendarFeedEnabled=" + externalCalendarFeedEnabled +
            ", inventoryQrEnabled=" + inventoryQrEnabled +
            ", notificationPreferencesEnabled=" + notificationPreferencesEnabled +
            ", webPushRemindersEnabled=" + webPushRemindersEnabled +
            ", eventPreparationEnabled=" + eventPreparationEnabled +
            ", scorePlaybackEnabled=" + scorePlaybackEnabled +
            ", inventoryLoanSheetEnabled=" + inventoryLoanSheetEnabled +
            ", inventorySignatureEnabled=" + inventorySignatureEnabled +
            ", calendarEnabled=" + calendarEnabled +
            ", eventPayoutsEnabled=" + eventPayoutsEnabled +
            ", scoreWritingEnabled=" + scoreWritingEnabled +
            ", entityVersion=" + entityVersion +
            '}';
    }
}
